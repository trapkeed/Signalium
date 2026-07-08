import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  positionTelemetryTable,
  trainerActionsTable,
  eaConnectionsTable,
  eaRegistrationsTable,
} from "@workspace/db";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requireApiKeyAuth } from "../middlewares/requireApiKeyAuth";
import { decideAction, TRAINER_ACTIONS, type TelemetrySnapshot } from "../lib/qdeTrainer";
import { deliverAction, getActiveConnections } from "../ws/eaGateway";
import { checkApiAccess, checkAutonomousAccess, checkSymbolLimit } from "../lib/entitlementEngine";

const router = Router();

function parseTelemetryBody(body: unknown): (TelemetrySnapshot & { symbol?: string }) | null {
  if (!body || typeof body !== "object") return null;
  const d = body as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

  const balance = num(d.balance);
  const equity = num(d.equity);
  const margin = num(d.margin);
  const freeMargin = num(d.freeMargin);
  const openPositions = num(d.openPositions);
  const floatingPnl = num(d.floatingPnl);
  if (balance === undefined || equity === undefined || margin === undefined || freeMargin === undefined || openPositions === undefined || floatingPnl === undefined) {
    return null;
  }

  return {
    symbol: typeof d.symbol === "string" ? d.symbol : undefined,
    balance, equity, margin, freeMargin, openPositions, floatingPnl,
    entryPrice: num(d.entryPrice) ?? null,
    currentPrice: num(d.currentPrice) ?? null,
    spread: num(d.spread) ?? null,
    swap: num(d.swap) ?? null,
    commission: num(d.commission) ?? null,
    drawdown: num(d.drawdown) ?? null,
    tradeAgeSeconds: num(d.tradeAgeSeconds) ?? null,
  };
}

// ─── EA-facing (HTTP fallback for the offline/no-WebSocket case) ───────────

// Every-30s telemetry ingest. Mirrors the WebSocket "telemetry" message so an
// EA that can't hold a socket open (or whose socket just dropped) still gets
// forwarded to the trainer and receives an action back synchronously.
router.post("/telemetry", requireApiKeyAuth, async (req, res) => {
  const telemetry = parseTelemetryBody(req.body);
  if (!telemetry) return res.status(400).json({ error: "Invalid telemetry payload" });

  const auth = req.eaAuth!;

  const apiAccess = await checkApiAccess(auth.userId);
  if (!apiAccess.allowed) {
    return res.status(403).json({ error: apiAccess.message, code: apiAccess.code });
  }
  const symbolCheck = await checkSymbolLimit(auth.userId, telemetry.symbol);
  if (!symbolCheck.allowed) {
    return res.status(403).json({ error: symbolCheck.message, code: symbolCheck.code });
  }

  try {
    const [row] = await db.insert(positionTelemetryTable).values({
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      eaRegistrationId: auth.eaRegistrationId,
      symbol: telemetry.symbol ?? null,
      balance: telemetry.balance,
      equity: telemetry.equity,
      margin: telemetry.margin,
      freeMargin: telemetry.freeMargin,
      openPositions: telemetry.openPositions,
      floatingPnl: telemetry.floatingPnl,
      entryPrice: telemetry.entryPrice ?? null,
      currentPrice: telemetry.currentPrice ?? null,
      spread: telemetry.spread ?? null,
      swap: telemetry.swap ?? null,
      commission: telemetry.commission ?? null,
      drawdown: telemetry.drawdown ?? null,
      tradeAgeSeconds: telemetry.tradeAgeSeconds ?? null,
    }).returning();

    const autonomousAccess = await checkAutonomousAccess(auth.userId);
    if (!autonomousAccess.allowed) {
      return res.status(202).json({
        telemetryId: row.id,
        action: null,
        code: autonomousAccess.code,
        message: autonomousAccess.message,
      });
    }

    let decision;
    try {
      decision = await decideAction(telemetry);
    } catch (err) {
      req.log.error(err, "Trainer decision failed after retries");
      return res.status(202).json({ telemetryId: row.id, action: null, message: "Telemetry recorded; trainer unavailable" });
    }

    const [actionRow] = await db.insert(trainerActionsTable).values({
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      eaRegistrationId: auth.eaRegistrationId,
      telemetryId: row.id,
      symbol: telemetry.symbol ?? null,
      action: decision.action,
      reasoning: decision.reasoning,
      status: "queued",
    }).returning();

    // Since this is a synchronous HTTP round trip, mark delivered immediately
    // (the response body IS the delivery) rather than relying on the socket.
    const [delivered] = await db.update(trainerActionsTable)
      .set({ status: "delivered", deliveredAt: new Date() })
      .where(eq(trainerActionsTable.id, actionRow.id))
      .returning();

    return res.status(201).json({ telemetryId: row.id, action: delivered });
  } catch (err) {
    req.log.error(err, "Failed to process EA telemetry");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Poll fallback for pending (queued) actions — used if a WebSocket delivery
// attempt failed while the EA was offline and it later resumes via polling
// instead of reconnecting the socket.
router.get("/actions/pending", requireApiKeyAuth, async (req, res) => {
  const auth = req.eaAuth!;

  const apiAccess = await checkApiAccess(auth.userId);
  if (!apiAccess.allowed) {
    return res.status(403).json({ error: apiAccess.message, code: apiAccess.code });
  }

  try {
    const queued = await db.select().from(trainerActionsTable)
      .where(and(eq(trainerActionsTable.eaRegistrationId, auth.eaRegistrationId), eq(trainerActionsTable.status, "queued")))
      .orderBy(trainerActionsTable.createdAt);

    if (queued.length > 0) {
      await db.update(trainerActionsTable)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(and(eq(trainerActionsTable.eaRegistrationId, auth.eaRegistrationId), eq(trainerActionsTable.status, "queued")));
    }

    return res.json(queued);
  } catch (err) {
    req.log.error(err, "Failed to fetch pending actions");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// EA acknowledges it has applied an action — closes the loop for observability.
router.post("/actions/:id/ack", requireApiKeyAuth, async (req, res) => {
  const auth = req.eaAuth!;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [action] = await db.select().from(trainerActionsTable).where(eq(trainerActionsTable.id, id));
    if (!action || action.eaRegistrationId !== auth.eaRegistrationId) {
      return res.status(404).json({ error: "Not found" });
    }
    const [updated] = await db.update(trainerActionsTable)
      .set({ status: "acknowledged", acknowledgedAt: new Date() })
      .where(eq(trainerActionsTable.id, id))
      .returning();
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to acknowledge action");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── User-facing ────────────────────────────────────────────────────────────

router.get("/telemetry", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const rows = await db.select().from(positionTelemetryTable)
      .where(eq(positionTelemetryTable.userId, userId))
      .orderBy(desc(positionTelemetryTable.receivedAt))
      .limit(100);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list telemetry");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/actions", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const rows = await db.select().from(trainerActionsTable)
      .where(eq(trainerActionsTable.userId, userId))
      .orderBy(desc(trainerActionsTable.createdAt))
      .limit(100);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list trainer actions");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin observability ────────────────────────────────────────────────────

router.get("/admin/connections", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(eaConnectionsTable)
      .orderBy(desc(eaConnectionsTable.connectedAt))
      .limit(200);
    const live = getActiveConnections();
    const withLiveStatus = rows.map((r) => ({
      ...r,
      isLive: live.has(r.eaRegistrationId) && live.get(r.eaRegistrationId)?.connectionId === r.connectionId,
    }));
    return res.json(withLiveStatus);
  } catch (err) {
    req.log.error(err, "Failed to list EA connections");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/telemetry", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(positionTelemetryTable)
      .orderBy(desc(positionTelemetryTable.receivedAt))
      .limit(200);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list telemetry");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/actions", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(trainerActionsTable)
      .orderBy(desc(trainerActionsTable.createdAt))
      .limit(200);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list trainer actions");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/stats/overview", requireAdmin, async (req, res) => {
  try {
    const live = getActiveConnections();
    const liveCount = live.size;

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const [{ telemetryLast5Min }] = await db.select({ telemetryLast5Min: sql<number>`count(*)::int` })
      .from(positionTelemetryTable)
      .where(gte(positionTelemetryTable.receivedAt, fiveMinutesAgo));

    const actionRows = await db.select({
      action: trainerActionsTable.action,
      count: sql<number>`count(*)::int`,
    }).from(trainerActionsTable)
      .where(gte(trainerActionsTable.createdAt, fiveMinutesAgo))
      .groupBy(trainerActionsTable.action);

    const actionBreakdown = Object.fromEntries(TRAINER_ACTIONS.map((a) => [a, 0])) as Record<string, number>;
    for (const r of actionRows) actionBreakdown[r.action] = r.count;

    const [{ queueDepth }] = await db.select({ queueDepth: sql<number>`count(*)::int` })
      .from(trainerActionsTable)
      .where(eq(trainerActionsTable.status, "queued"));

    const [{ failedCount }] = await db.select({ failedCount: sql<number>`count(*)::int` })
      .from(trainerActionsTable)
      .where(gte(trainerActionsTable.retryCount, 1));

    const [{ registeredTerminals }] = await db.select({ registeredTerminals: sql<number>`count(*)::int` })
      .from(eaRegistrationsTable)
      .where(eq(eaRegistrationsTable.isActive, true));

    return res.json({
      liveConnections: liveCount,
      registeredTerminals,
      telemetryLast5Min,
      actionBreakdownLast5Min: actionBreakdown,
      queueDepth,
      actionsWithRetries: failedCount,
    });
  } catch (err) {
    req.log.error(err, "Failed to build QDE stats overview");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Admin utility: force a (re)delivery attempt for a queued action.
router.post("/admin/actions/:id/redeliver", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const delivered = await deliverAction(id);
    return res.json({ delivered });
  } catch (err) {
    req.log.error(err, "Failed to redeliver action");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
