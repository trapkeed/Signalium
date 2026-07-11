import { Router } from "express";
import { getAuth } from "../lib/auth";
import {
  db,
  positionTelemetryTable,
  trainerActionsTable,
  eaConnectionsTable,
  eaRegistrationsTable,
  openPositionsTable,
  brokerTicketsTable,
  executionConfirmationsTable,
  brokerStateTable,
} from "@workspace/db";
import { eq, desc, and, gte, isNull, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requireApiKeyAuth } from "../middlewares/requireApiKeyAuth";
import { decideAction, TRAINER_ACTIONS, type TelemetrySnapshot } from "../lib/qdeTrainer";
import { deliverAction, getActiveConnections } from "../ws/eaGateway";
import { checkApiAccess, checkAutonomousAccess, checkSymbolLimit } from "../lib/entitlementEngine";
import { logAudit } from "../lib/auditLog";
import { isQdeActiveForUser } from "../lib/qdeSwitch";
import {
  syncPositions,
  parsePositionList,
  parseBrokerStatePayload,
  nextSequenceNum,
} from "../lib/positionSync";

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

    // Per-user QDE start/stop switch: while stopped, no QDE decision is
    // issued for this user (safe no-op) — the shared trainer and every
    // other user's telemetry/decision flow are unaffected.
    const qdeActive = await isQdeActiveForUser(auth.userId);
    if (!qdeActive) {
      return res.status(202).json({
        telemetryId: row.id,
        action: null,
        code: "QDE_STOPPED",
        message: "QDE is currently stopped for this account.",
      });
    }

    let decision;
    try {
      decision = await decideAction(telemetry);
    } catch (err) {
      req.log.error(err, "Trainer decision failed after retries");
      return res.status(202).json({ telemetryId: row.id, action: null, message: "Telemetry recorded; trainer unavailable" });
    }

    // Insert with an atomically-computed per-EA sequence number (C8 ordering guarantee).
    const [delivered] = await db.transaction(async (tx) => {
      const seqNum = await nextSequenceNum(tx, auth.eaRegistrationId);
      const [actionRow] = await tx.insert(trainerActionsTable).values({
        userId: auth.userId,
        apiKeyId: auth.apiKeyId,
        eaRegistrationId: auth.eaRegistrationId,
        telemetryId: row.id,
        symbol: telemetry.symbol ?? null,
        action: decision.action,
        reasoning: decision.reasoning,
        sequenceNum: seqNum,
        status: "queued",
      }).returning();

      // Since this is a synchronous HTTP round trip, mark delivered immediately
      // (the response body IS the delivery) rather than relying on the socket.
      const [d] = await tx.update(trainerActionsTable)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(eq(trainerActionsTable.id, actionRow.id))
        .returning();
      return [d];
    });

    // Audit only consequential model requests (an actual trading action, not
    // every HOLD tick) — HOLD is the overwhelming majority of decisions at a
    // 30s telemetry cadence, and per-tick logging would drown the audit log
    // without adding security value over the dedicated telemetry/actions tables.
    if (decision.action !== "HOLD") {
      await logAudit(auth.userId, "model_request.action_issued", "trainer_action", String(delivered.id), {
        action: decision.action,
        symbol: telemetry.symbol ?? null,
        eaRegistrationId: auth.eaRegistrationId,
        sequenceNum: delivered.sequenceNum,
      });
    }

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
    // Return queued actions in strict sequence_num order (nulls last for
    // legacy pre-C8 rows) to honour command ordering guarantees.
    const queued = await db.select().from(trainerActionsTable)
      .where(and(eq(trainerActionsTable.eaRegistrationId, auth.eaRegistrationId), eq(trainerActionsTable.status, "queued")))
      .orderBy(trainerActionsTable.sequenceNum, trainerActionsTable.createdAt);

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

// ─── C8: Execution confirmation ──────────────────────────────────────────────
// EA reports the broker-level result of executing a command.  Different from
// "ack" (which just means "I received the message"); this records what the
// broker actually did — the ticket affected, the price achieved, and whether
// the execution succeeded.
router.post("/actions/:id/confirm", requireApiKeyAuth, async (req, res) => {
  const auth = req.eaAuth!;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const body = req.body as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

  const success = typeof body.success === "boolean" ? body.success : undefined;
  if (success === undefined) {
    return res.status(400).json({ error: "success (boolean) is required" });
  }

  try {
    const [action] = await db.select().from(trainerActionsTable).where(eq(trainerActionsTable.id, id));
    if (!action || action.eaRegistrationId !== auth.eaRegistrationId) {
      return res.status(404).json({ error: "Not found" });
    }

    // Idempotency: if a confirmation already exists for this action, return it.
    const [existing] = await db.select().from(executionConfirmationsTable)
      .where(eq(executionConfirmationsTable.trainerActionId, id));
    if (existing) {
      return res.json(existing);
    }

    const [confirmation] = await db.insert(executionConfirmationsTable).values({
      userId: auth.userId,
      eaRegistrationId: auth.eaRegistrationId,
      trainerActionId: id,
      brokerTicketId: typeof body.brokerTicketId === "string" ? body.brokerTicketId : null,
      brokerType: (body.brokerType === "GENERIC" ? "GENERIC" : "MT5") as "MT5" | "GENERIC",
      executedAction: action.action as "HOLD" | "ADD" | "REDUCE" | "TRAIL" | "BREAKEVEN" | "LOCK_PROFIT" | "CLOSE",
      success,
      actualPrice: num(body.actualPrice) ?? null,
      actualLots: num(body.actualLots) ?? null,
      slippage: num(body.slippage) ?? null,
      executionDelayMs: typeof body.executionDelayMs === "number" ? body.executionDelayMs : null,
      errorCode: typeof body.errorCode === "string" ? body.errorCode : null,
      errorMessage: typeof body.errorMessage === "string" ? body.errorMessage : null,
    }).returning();

    // Advance the action status to "confirmed" (supersedes "acknowledged").
    await db.update(trainerActionsTable)
      .set({ status: "confirmed", confirmedAt: new Date(), acknowledgedAt: action.acknowledgedAt ?? new Date() })
      .where(eq(trainerActionsTable.id, id));

    await logAudit(auth.userId, "model_request.action_confirmed", "trainer_action", String(id), {
      success,
      executedAction: action.action,
      brokerTicketId: confirmation.brokerTicketId,
      eaRegistrationId: auth.eaRegistrationId,
    });

    return res.status(201).json(confirmation);
  } catch (err) {
    req.log.error(err, "Failed to record execution confirmation");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── C8: Position synchronisation ────────────────────────────────────────────
// EA pushes its full current open position list. We upsert each position,
// write broker-ticket audit events for new/modified/closed tickets, and return
// counts for the EA to log.
router.post("/positions/sync", requireApiKeyAuth, async (req, res) => {
  const auth = req.eaAuth!;

  const apiAccess = await checkApiAccess(auth.userId);
  if (!apiAccess.allowed) {
    return res.status(403).json({ error: apiAccess.message, code: apiAccess.code });
  }

  // Accept either a top-level array or { positions: [...] } envelope.
  const rawPositions = Array.isArray(req.body) ? req.body : (req.body as Record<string, unknown>)?.positions;
  const positions = parsePositionList(rawPositions);
  if (positions === null) {
    return res.status(400).json({ error: "Invalid positions payload — expected array of position objects" });
  }

  try {
    const result = await syncPositions(auth.userId, auth.eaRegistrationId, positions);
    return res.json(result);
  } catch (err) {
    req.log.error(err, "Failed to sync positions");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── C8: Broker state synchronisation ────────────────────────────────────────
// EA reports its broker connection state (connected/disconnected/error) and
// account snapshot. One row per EA registration — upserted on every call.
router.post("/broker-state", requireApiKeyAuth, async (req, res) => {
  const auth = req.eaAuth!;

  const payload = parseBrokerStatePayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: "connectionStatus (connected|disconnected|error) is required" });
  }

  try {
    const [row] = await db
      .insert(brokerStateTable)
      .values({
        userId: auth.userId,
        eaRegistrationId: auth.eaRegistrationId,
        brokerType: payload.brokerType,
        connectionStatus: payload.connectionStatus,
        brokerServer: payload.brokerServer ?? null,
        accountNumber: payload.accountNumber ?? null,
        accountCurrency: payload.accountCurrency ?? null,
        accountBalance: payload.accountBalance ?? null,
        accountEquity: payload.accountEquity ?? null,
        accountLeverage: payload.accountLeverage ?? null,
        accountMarginLevel: payload.accountMarginLevel ?? null,
        pingMs: payload.pingMs ?? null,
        terminalBuild: payload.terminalBuild ?? null,
        platformVersion: payload.platformVersion ?? null,
        tradeAllowed: payload.tradeAllowed ?? null,
        expertEnabled: payload.expertEnabled ?? null,
        errorMessage: payload.errorMessage ?? null,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [brokerStateTable.eaRegistrationId],
        set: {
          brokerType: payload.brokerType,
          connectionStatus: payload.connectionStatus,
          brokerServer: payload.brokerServer ?? null,
          accountNumber: payload.accountNumber ?? null,
          accountCurrency: payload.accountCurrency ?? null,
          accountBalance: payload.accountBalance ?? null,
          accountEquity: payload.accountEquity ?? null,
          accountLeverage: payload.accountLeverage ?? null,
          accountMarginLevel: payload.accountMarginLevel ?? null,
          pingMs: payload.pingMs ?? null,
          terminalBuild: payload.terminalBuild ?? null,
          platformVersion: payload.platformVersion ?? null,
          tradeAllowed: payload.tradeAllowed ?? null,
          expertEnabled: payload.expertEnabled ?? null,
          errorMessage: payload.errorMessage ?? null,
          syncedAt: new Date(),
        },
      })
      .returning();

    return res.json(row);
  } catch (err) {
    req.log.error(err, "Failed to sync broker state");
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

// C8: User's current open positions (live state from last sync).
router.get("/positions", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const rows = await db.select().from(openPositionsTable)
      .where(and(eq(openPositionsTable.userId, userId), isNull(openPositionsTable.closedAt)))
      .orderBy(desc(openPositionsTable.syncedAt));
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list open positions");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// C8: User's broker connection state.
router.get("/broker-state", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const rows = await db.select().from(brokerStateTable)
      .where(eq(brokerStateTable.userId, userId))
      .orderBy(desc(brokerStateTable.syncedAt));
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list broker states");
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

// C8: Admin view of all open positions across all EAs.
router.get("/admin/open-positions", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(openPositionsTable)
      .orderBy(desc(openPositionsTable.syncedAt))
      .limit(500);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list open positions");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// C8: Admin view of broker ticket audit log.
router.get("/admin/broker-tickets", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(brokerTicketsTable)
      .orderBy(desc(brokerTicketsTable.recordedAt))
      .limit(500);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list broker tickets");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// C8: Admin view of execution confirmations.
router.get("/admin/execution-confirmations", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(executionConfirmationsTable)
      .orderBy(desc(executionConfirmationsTable.confirmedAt))
      .limit(500);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list execution confirmations");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// C8: Admin view of broker states for all EAs.
router.get("/admin/broker-states", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(brokerStateTable)
      .orderBy(desc(brokerStateTable.syncedAt))
      .limit(200);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list broker states");
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

    const [{ openPositionCount }] = await db.select({ openPositionCount: sql<number>`count(*)::int` })
      .from(openPositionsTable)
      .where(isNull(openPositionsTable.closedAt));

    const [{ confirmedCount }] = await db.select({ confirmedCount: sql<number>`count(*)::int` })
      .from(executionConfirmationsTable)
      .where(gte(executionConfirmationsTable.confirmedAt, fiveMinutesAgo));

    return res.json({
      liveConnections: liveCount,
      registeredTerminals,
      telemetryLast5Min,
      actionBreakdownLast5Min: actionBreakdown,
      queueDepth,
      actionsWithRetries: failedCount,
      openPositionCount,
      confirmationsLast5Min: confirmedCount,
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
