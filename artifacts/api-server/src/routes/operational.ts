/**
 * S22A — Operational Infrastructure Routes
 *
 * Mounts under /operational
 *
 *  POST /operational/telemetry           — EA ingest (authenticated by API key)
 *  GET  /operational/telemetry           — admin: list/filter snapshots
 *  GET  /operational/telemetry/replay    — admin: account replay history
 *
 *  POST /operational/heartbeat           — EA ping (authenticated by API key)
 *  GET  /operational/heartbeat/status    — admin: all EA heartbeat states
 *  GET  /operational/heartbeat/offline   — admin: currently offline EAs
 *
 *  POST /operational/execution-quality   — EA ingest execution quality
 *  GET  /operational/execution-quality   — admin: list + broker rankings
 *
 *  GET  /operational/risk/alerts         — admin: list risk alerts
 *  POST /operational/risk/alerts/:id/acknowledge — admin: acknowledge alert
 *
 *  GET  /operational/incidents           — admin: list incidents
 *  POST /operational/incidents           — admin: create incident
 *  PATCH /operational/incidents/:id      — admin: update incident
 *  DELETE /operational/incidents/:id     — admin: delete incident
 *
 *  GET  /operational/alerts              — admin: list platform alerts
 *  POST /operational/alerts/:id/acknowledge — admin: acknowledge platform alert
 *
 *  GET  /operational/dashboard           — admin: ops overview stats
 *  GET  /operational/support/user/:userId — staff: user support view
 */

import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db } from "@workspace/db";
import {
  eaTelemetrySnapshotsTable,
  eaHeartbeatStatesTable,
  eaExecutionQualityTable,
  eaRiskAlertsTable,
  operationalIncidentsTable,
  platformAlertsTable,
  runtimeStatusTable,
  platformHealthSnapshotsTable,
  serviceDeploymentsTable,
  opportunitiesTable,
  tradeTimelineTable,
  userTradingSettingsTable,
  qdeDeploymentsTable,
  alertDeliveryLogTable,
  alertChannelSettingsTable,
} from "@workspace/db";
import {
  eq,
  desc,
  and,
  gte,
  lte,
  isNull,
  ne,
  sql,
  inArray,
  or,
  lt,
} from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requireStaff } from "../middlewares/requireAdmin";
import { requireApiKeyAuth } from "../middlewares/requireApiKeyAuth";
import { getLatestSnapshot } from "../lib/platformHealth";
import { emitPlatformAlert } from "../lib/alerting";
import { getAlertChannelSettings } from "../lib/alertDispatch";
import { computeSymbolHealth } from "../lib/symbolHealth";
import { broadcastOpsEvent } from "../ws/adminOpsGateway";
import pino from "pino";

const logger = pino({ name: "operational-routes" });

// Offline threshold: 120 seconds
const OFFLINE_THRESHOLD_MS = 120_000;

const router = Router();

// ─── Utility: compute derived EA heartbeat state ──────────────────────────────

function computeHeartbeatState(row: {
  lastSeenAt: Date | null;
  eaVersion: string | null;
  platformVersion: string | null;
}): "ONLINE" | "DEGRADED" | "OFFLINE" {
  if (!row.lastSeenAt) return "OFFLINE";
  const ageMs = Date.now() - row.lastSeenAt.getTime();
  if (ageMs > OFFLINE_THRESHOLD_MS) return "OFFLINE";
  if (ageMs > OFFLINE_THRESHOLD_MS / 2) return "DEGRADED"; // 60-120s = degraded
  return "ONLINE";
}

// ─── Utility: compute execution quality score ─────────────────────────────────

function computeQualityScore(data: {
  avgSlippagePoints?: number | null;
  rejectedOrders?: number | null;
  requotes?: number | null;
  avgExecutionLatencyMs?: number | null;
  spreadExpansionPoints?: number | null;
  sampleCount: number;
}): number {
  if (data.sampleCount === 0) return 50; // neutral
  let score = 100;

  const slippage = data.avgSlippagePoints ?? 0;
  if (slippage > 5) score -= Math.min(30, (slippage - 5) * 3);
  else if (slippage > 2) score -= (slippage - 2) * 5;

  const latency = data.avgExecutionLatencyMs ?? 0;
  if (latency > 500) score -= Math.min(20, (latency - 500) / 50);
  else if (latency > 200) score -= (latency - 200) / 30;

  const rejRate = data.sampleCount > 0 ? (data.rejectedOrders ?? 0) / data.sampleCount : 0;
  score -= Math.min(25, rejRate * 100);

  const requoteRate = data.sampleCount > 0 ? (data.requotes ?? 0) / data.sampleCount : 0;
  score -= Math.min(15, requoteRate * 50);

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── POST /operational/telemetry — EA ingest ─────────────────────────────────

router.post("/telemetry", requireApiKeyAuth, async (req, res) => {
  try {
    const userId = req.eaAuth!.userId;
    const body = req.body as Record<string, unknown>;

    const [row] = await db
      .insert(eaTelemetrySnapshotsTable)
      .values({
        userId,
        eaId: typeof body.eaId === "number" ? body.eaId : null,
        accountId: typeof body.accountId === "string" ? body.accountId : null,
        eaInstanceId: typeof body.eaInstanceId === "string" ? body.eaInstanceId : null,
        equity: typeof body.equity === "number" ? body.equity : null,
        balance: typeof body.balance === "number" ? body.balance : null,
        floatingPnL: typeof body.floatingPnL === "number" ? body.floatingPnL : null,
        marginLevel: typeof body.marginLevel === "number" ? body.marginLevel : null,
        freeMargin: typeof body.freeMargin === "number" ? body.freeMargin : null,
        openPositionsCount: typeof body.openPositionsCount === "number" ? body.openPositionsCount : null,
        activeSymbols: Array.isArray(body.activeSymbols) ? (body.activeSymbols as string[]) : null,
        brokerName: typeof body.brokerName === "string" ? body.brokerName : null,
        brokerServer: typeof body.brokerServer === "string" ? body.brokerServer : null,
        vpsLatencyMs: typeof body.vpsLatencyMs === "number" ? body.vpsLatencyMs : null,
        eaVersion: typeof body.eaVersion === "string" ? body.eaVersion : null,
        platformVersion: typeof body.platformVersion === "string" ? body.platformVersion : null,
        mt5BuildVersion: typeof body.mt5BuildVersion === "string" ? body.mt5BuildVersion : null,
        connectivityState: typeof body.connectivityState === "string" ? body.connectivityState : null,
        spreadInfo: body.spreadInfo && typeof body.spreadInfo === "object" ? body.spreadInfo as Record<string, unknown> : null,
        currentDrawdownPct: typeof body.currentDrawdownPct === "number" ? body.currentDrawdownPct : null,
        peakEquity: typeof body.peakEquity === "number" ? body.peakEquity : null,
        dailyDrawdownPct: typeof body.dailyDrawdownPct === "number" ? body.dailyDrawdownPct : null,
        weeklyDrawdownPct: typeof body.weeklyDrawdownPct === "number" ? body.weeklyDrawdownPct : null,
        executionStats: body.executionStats && typeof body.executionStats === "object" ? body.executionStats as Record<string, unknown> : null,
      })
      .returning();

    // Risk threshold checks — dedup by checking for an existing open (unresolved,
    // unacknowledged) alert of the same type for this user+instance today.
    const dailyDrawdown = typeof body.dailyDrawdownPct === "number" ? body.dailyDrawdownPct : null;
    const weeklyDrawdown = typeof body.weeklyDrawdownPct === "number" ? body.weeklyDrawdownPct : null;
    const marginLevel = typeof body.marginLevel === "number" ? body.marginLevel : null;
    const eaInstanceId = row.eaInstanceId ?? null;
    const eaId = row.eaId ?? null;

    // Helper: true if an open risk alert of the given type already exists today for this user/instance
    const hasOpenAlert = async (alertType: typeof eaRiskAlertsTable.$inferSelect["alertType"]) => {
      const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
      const conditions = [
        eq(eaRiskAlertsTable.userId, userId),
        eq(eaRiskAlertsTable.alertType, alertType),
        eq(eaRiskAlertsTable.acknowledged, false),
        gte(eaRiskAlertsTable.createdAt, todayStart),
      ];
      if (eaInstanceId) conditions.push(eq(eaRiskAlertsTable.eaInstanceId, eaInstanceId));
      const rows = await db.select({ id: eaRiskAlertsTable.id }).from(eaRiskAlertsTable).where(and(...conditions)).limit(1);
      return rows.length > 0;
    };

    if (dailyDrawdown !== null && dailyDrawdown > 5 && !(await hasOpenAlert("daily_drawdown"))) {
      const severity: "warning" | "critical" = dailyDrawdown > 10 ? "critical" : "warning";
      await db.insert(eaRiskAlertsTable).values({
        userId,
        eaId,
        eaInstanceId,
        alertType: "daily_drawdown",
        severity,
        currentValue: dailyDrawdown,
        thresholdValue: severity === "critical" ? 10 : 5,
        message: `Daily drawdown ${dailyDrawdown.toFixed(2)}% exceeds ${severity === "critical" ? "critical (10%)" : "warning (5%)"} threshold`,
      });

      if (severity === "critical") {
        await emitPlatformAlert({
          type: "high_drawdown",
          severity: "critical",
          message: `User ${userId}: daily drawdown ${dailyDrawdown.toFixed(2)}%`,
          userId,
          eaId,
          eaInstanceId,
        });
      }
    }

    if (weeklyDrawdown !== null && weeklyDrawdown > 10 && !(await hasOpenAlert("weekly_drawdown"))) {
      await db.insert(eaRiskAlertsTable).values({
        userId,
        eaId,
        eaInstanceId,
        alertType: "weekly_drawdown",
        severity: weeklyDrawdown > 20 ? "critical" : "warning",
        currentValue: weeklyDrawdown,
        thresholdValue: weeklyDrawdown > 20 ? 20 : 10,
        message: `Weekly drawdown ${weeklyDrawdown.toFixed(2)}% exceeds threshold`,
      });
    }

    if (marginLevel !== null && marginLevel < 150 && !(await hasOpenAlert("margin_stress"))) {
      await db.insert(eaRiskAlertsTable).values({
        userId,
        eaId,
        eaInstanceId,
        alertType: "margin_stress",
        severity: marginLevel < 110 ? "critical" : "warning",
        currentValue: marginLevel,
        thresholdValue: marginLevel < 110 ? 110 : 150,
        message: `Margin level ${marginLevel.toFixed(0)}% — ${marginLevel < 110 ? "CRITICAL" : "warning"}`,
      });
    }

    return res.status(201).json({ id: row.id });
  } catch (err) {
    req.log.error(err, "Telemetry ingest error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/telemetry — admin list ──────────────────────────────────

router.get("/telemetry", requireAdmin, async (req, res) => {
  try {
    const { userId, eaInstanceId, from, to, limit = "100" } = req.query as Record<string, string | undefined>;
    const conditions = [];
    if (userId) conditions.push(eq(eaTelemetrySnapshotsTable.userId, userId));
    if (eaInstanceId) conditions.push(eq(eaTelemetrySnapshotsTable.eaInstanceId, eaInstanceId));
    if (from) conditions.push(gte(eaTelemetrySnapshotsTable.createdAt, new Date(from)));
    if (to) conditions.push(lte(eaTelemetrySnapshotsTable.createdAt, new Date(to)));

    const rows = await db
      .select()
      .from(eaTelemetrySnapshotsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(eaTelemetrySnapshotsTable.createdAt))
      .limit(Math.min(1000, parseInt(limit, 10)));

    return res.json({ snapshots: rows, total: rows.length });
  } catch (err) {
    req.log.error(err, "Telemetry list error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/telemetry/replay — admin account replay ────────────────

router.get("/telemetry/replay", requireAdmin, async (req, res) => {
  try {
    const { userId, eaInstanceId, from, to } = req.query as Record<string, string | undefined>;
    if (!userId && !eaInstanceId) {
      return res.status(400).json({ error: "userId or eaInstanceId required" });
    }

    const conditions = [];
    if (userId) conditions.push(eq(eaTelemetrySnapshotsTable.userId, userId));
    if (eaInstanceId) conditions.push(eq(eaTelemetrySnapshotsTable.eaInstanceId, eaInstanceId));
    if (from) conditions.push(gte(eaTelemetrySnapshotsTable.createdAt, new Date(from)));
    if (to) conditions.push(lte(eaTelemetrySnapshotsTable.createdAt, new Date(to)));

    const rows = await db
      .select({
        id: eaTelemetrySnapshotsTable.id,
        createdAt: eaTelemetrySnapshotsTable.createdAt,
        equity: eaTelemetrySnapshotsTable.equity,
        balance: eaTelemetrySnapshotsTable.balance,
        floatingPnL: eaTelemetrySnapshotsTable.floatingPnL,
        marginLevel: eaTelemetrySnapshotsTable.marginLevel,
        openPositionsCount: eaTelemetrySnapshotsTable.openPositionsCount,
        currentDrawdownPct: eaTelemetrySnapshotsTable.currentDrawdownPct,
        dailyDrawdownPct: eaTelemetrySnapshotsTable.dailyDrawdownPct,
        vpsLatencyMs: eaTelemetrySnapshotsTable.vpsLatencyMs,
        connectivityState: eaTelemetrySnapshotsTable.connectivityState,
      })
      .from(eaTelemetrySnapshotsTable)
      .where(and(...conditions))
      .orderBy(eaTelemetrySnapshotsTable.createdAt)
      .limit(5000);

    return res.json({ points: rows });
  } catch (err) {
    req.log.error(err, "Telemetry replay error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /operational/heartbeat — EA ping ───────────────────────────────────

router.post("/heartbeat", requireApiKeyAuth, async (req, res) => {
  try {
    const userId = req.eaAuth!.userId;
    const body = req.body as Record<string, unknown>;

    const eaInstanceId = typeof body.eaInstanceId === "string" ? body.eaInstanceId : `${userId}-default`;
    const now = new Date();

    // Determine state from the ping payload
    let state: "ONLINE" | "DEGRADED" | "OFFLINE" | "UNAUTHORIZED" | "OUTDATED" = "ONLINE";
    if (typeof body.state === "string" && ["ONLINE", "DEGRADED", "OFFLINE", "UNAUTHORIZED", "OUTDATED"].includes(body.state)) {
      state = body.state as typeof state;
    }

    const existing = await db
      .select()
      .from(eaHeartbeatStatesTable)
      .where(and(eq(eaHeartbeatStatesTable.userId, userId), eq(eaHeartbeatStatesTable.eaInstanceId, eaInstanceId)))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(eaHeartbeatStatesTable).values({
        userId,
        eaId: typeof body.eaId === "number" ? body.eaId : null,
        eaInstanceId,
        state,
        lastSeenAt: now,
        lastPingAt: now,
        eaVersion: typeof body.eaVersion === "string" ? body.eaVersion : null,
        platformVersion: typeof body.platformVersion === "string" ? body.platformVersion : null,
        brokerName: typeof body.brokerName === "string" ? body.brokerName : null,
        accountId: typeof body.accountId === "string" ? body.accountId : null,
        metadata: body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : null,
      });
    } else {
      const prev = existing[0]!;
      // Detect transition to offline — emit alert only once per offline event
      const wasOnline = (prev.state as string) === "ONLINE" || (prev.state as string) === "DEGRADED";
      const isNowOffline = (state as string) === "OFFLINE";

      await db
        .update(eaHeartbeatStatesTable)
        .set({
          state,
          lastSeenAt: now,
          lastPingAt: now,
          offlineSince: isNowOffline && wasOnline ? now : ((state as string) !== "OFFLINE" ? null : prev.offlineSince),
          eaVersion: typeof body.eaVersion === "string" ? body.eaVersion : prev.eaVersion,
          platformVersion: typeof body.platformVersion === "string" ? body.platformVersion : prev.platformVersion,
          brokerName: typeof body.brokerName === "string" ? body.brokerName : prev.brokerName,
          accountId: typeof body.accountId === "string" ? body.accountId : prev.accountId,
          metadata: body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : prev.metadata,
          updatedAt: now,
        })
        .where(and(eq(eaHeartbeatStatesTable.userId, userId), eq(eaHeartbeatStatesTable.eaInstanceId, eaInstanceId)));

      if (isNowOffline && wasOnline && !prev.alertSentAt) {
        await emitPlatformAlert({
          type: "ea_offline",
          severity: "warning",
          message: `EA instance ${eaInstanceId} went offline`,
          userId,
          eaId: prev.eaId ?? null,
          eaInstanceId,
        });
        await db
          .update(eaHeartbeatStatesTable)
          .set({ alertSentAt: now })
          .where(and(eq(eaHeartbeatStatesTable.userId, userId), eq(eaHeartbeatStatesTable.eaInstanceId, eaInstanceId)));
      }

      // Reset alertSentAt when EA comes back online
      if (!isNowOffline && prev.alertSentAt) {
        await db
          .update(eaHeartbeatStatesTable)
          .set({ alertSentAt: null, offlineSince: null })
          .where(and(eq(eaHeartbeatStatesTable.userId, userId), eq(eaHeartbeatStatesTable.eaInstanceId, eaInstanceId)));
      }
    }

    // Also update runtimeStatusTable for backward compat
    await db
      .insert(runtimeStatusTable)
      .values({ id: userId, userId, lastHeartbeat: now })
      .onConflictDoUpdate({
        target: runtimeStatusTable.userId,
        set: { lastHeartbeat: now },
      });

    return res.json({ ok: true, state, ts: now.toISOString() });
  } catch (err) {
    req.log.error(err, "Heartbeat ping error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/heartbeat/status — admin: all heartbeat states ──────────

router.get("/heartbeat/status", requireAdmin, async (req, res) => {
  try {
    const { state, userId } = req.query as Record<string, string | undefined>;

    const conditions = [];
    if (state) conditions.push(eq(eaHeartbeatStatesTable.state, state as "ONLINE" | "DEGRADED" | "OFFLINE" | "UNAUTHORIZED" | "OUTDATED"));
    if (userId) conditions.push(eq(eaHeartbeatStatesTable.userId, userId));

    const rows = await db
      .select()
      .from(eaHeartbeatStatesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(eaHeartbeatStatesTable.lastSeenAt));

    // Recompute derived state based on actual last-seen time
    const now = Date.now();
    const enriched = rows.map((r) => {
      const ageMs = r.lastSeenAt ? now - r.lastSeenAt.getTime() : Infinity;
      const derivedState = ageMs > OFFLINE_THRESHOLD_MS ? "OFFLINE"
        : ageMs > OFFLINE_THRESHOLD_MS / 2 ? "DEGRADED"
        : r.state;
      return { ...r, derivedState };
    });

    const summary = {
      online: enriched.filter((r) => r.derivedState === "ONLINE").length,
      degraded: enriched.filter((r) => r.derivedState === "DEGRADED").length,
      offline: enriched.filter((r) => r.derivedState === "OFFLINE").length,
      unauthorized: enriched.filter((r) => r.derivedState === "UNAUTHORIZED").length,
      outdated: enriched.filter((r) => r.derivedState === "OUTDATED").length,
    };

    return res.json({ instances: enriched, summary });
  } catch (err) {
    req.log.error(err, "Heartbeat status error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/heartbeat/offline — admin: currently offline ────────────

router.get("/heartbeat/offline", requireAdmin, async (req, res) => {
  try {
    const threshold = new Date(Date.now() - OFFLINE_THRESHOLD_MS);
    const rows = await db
      .select()
      .from(eaHeartbeatStatesTable)
      .where(
        or(
          eq(eaHeartbeatStatesTable.state, "OFFLINE"),
          lt(eaHeartbeatStatesTable.lastSeenAt, threshold),
          isNull(eaHeartbeatStatesTable.lastSeenAt),
        ),
      )
      .orderBy(desc(eaHeartbeatStatesTable.updatedAt));

    return res.json({ offline: rows, count: rows.length });
  } catch (err) {
    req.log.error(err, "Heartbeat offline error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /operational/execution-quality — EA ingest ────────────────────────

router.post("/execution-quality", requireApiKeyAuth, async (req, res) => {
  try {
    const userId = req.eaAuth!.userId;
    const body = req.body as Record<string, unknown>;
    const today = new Date().toISOString().slice(0, 10);
    const eaInstanceId = typeof body.eaInstanceId === "string" ? body.eaInstanceId : null;

    const existing = await db
      .select()
      .from(eaExecutionQualityTable)
      .where(
        and(
          eq(eaExecutionQualityTable.userId, userId),
          eq(eaExecutionQualityTable.periodDate, today),
          ...(eaInstanceId ? [eq(eaExecutionQualityTable.eaInstanceId, eaInstanceId)] : [isNull(eaExecutionQualityTable.eaInstanceId)]),
        ),
      )
      .limit(1);

    const newSlippage = typeof body.slippagePoints === "number" ? body.slippagePoints : null;
    const newLatency = typeof body.executionLatencyMs === "number" ? body.executionLatencyMs : null;
    const newRejections = typeof body.rejectedOrders === "number" ? body.rejectedOrders : 0;
    const newRequotes = typeof body.requotes === "number" ? body.requotes : 0;
    const newSpreadExp = typeof body.spreadExpansionPoints === "number" ? body.spreadExpansionPoints : null;

    if (existing.length === 0) {
      const sampleCount = 1;
      const score = computeQualityScore({
        avgSlippagePoints: newSlippage,
        rejectedOrders: newRejections,
        requotes: newRequotes,
        avgExecutionLatencyMs: newLatency,
        spreadExpansionPoints: newSpreadExp,
        sampleCount,
      });
      await db.insert(eaExecutionQualityTable).values({
        userId,
        eaId: typeof body.eaId === "number" ? body.eaId : null,
        eaInstanceId,
        brokerName: typeof body.brokerName === "string" ? body.brokerName : null,
        avgSlippagePoints: newSlippage,
        rejectedOrders: newRejections,
        requotes: newRequotes,
        avgExecutionLatencyMs: newLatency,
        spreadExpansionPoints: newSpreadExp,
        qualityScore: score,
        sampleCount,
        periodDate: today,
      });
    } else {
      const row = existing[0]!;
      const n = row.sampleCount;
      const avg = (prev: number | null, curr: number | null) =>
        prev !== null && curr !== null ? (prev * n + curr) / (n + 1)
        : curr ?? prev;

      const sampleCount = n + 1;
      const avgSlippage = avg(row.avgSlippagePoints, newSlippage);
      const avgLatency = avg(row.avgExecutionLatencyMs, newLatency);
      const avgSpread = avg(row.spreadExpansionPoints, newSpreadExp);
      const score = computeQualityScore({
        avgSlippagePoints: avgSlippage,
        rejectedOrders: row.rejectedOrders + newRejections,
        requotes: row.requotes + newRequotes,
        avgExecutionLatencyMs: avgLatency,
        spreadExpansionPoints: avgSpread,
        sampleCount,
      });

      await db
        .update(eaExecutionQualityTable)
        .set({
          avgSlippagePoints: avgSlippage,
          avgExecutionLatencyMs: avgLatency,
          spreadExpansionPoints: avgSpread,
          rejectedOrders: row.rejectedOrders + newRejections,
          requotes: row.requotes + newRequotes,
          qualityScore: score,
          sampleCount,
          updatedAt: new Date(),
        })
        .where(eq(eaExecutionQualityTable.id, row.id));
    }

    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "Execution quality ingest error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/execution-quality — admin ───────────────────────────────

router.get("/execution-quality", requireAdmin, async (req, res) => {
  try {
    const { userId, brokerName, from, to } = req.query as Record<string, string | undefined>;
    const conditions = [];
    if (userId) conditions.push(eq(eaExecutionQualityTable.userId, userId));
    if (brokerName) conditions.push(eq(eaExecutionQualityTable.brokerName, brokerName));
    if (from) conditions.push(gte(eaExecutionQualityTable.periodDate, from));
    if (to) conditions.push(lte(eaExecutionQualityTable.periodDate, to));

    const rows = await db
      .select()
      .from(eaExecutionQualityTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(eaExecutionQualityTable.periodDate))
      .limit(500);

    // Broker rankings: aggregate by brokerName
    const brokerMap = new Map<string, { totalScore: number; count: number; rejections: number; requotes: number; slippage: number; latency: number }>();
    for (const row of rows) {
      if (!row.brokerName) continue;
      const key = row.brokerName;
      const existing = brokerMap.get(key) ?? { totalScore: 0, count: 0, rejections: 0, requotes: 0, slippage: 0, latency: 0 };
      brokerMap.set(key, {
        totalScore: existing.totalScore + (row.qualityScore ?? 50),
        count: existing.count + 1,
        rejections: existing.rejections + (row.rejectedOrders ?? 0),
        requotes: existing.requotes + (row.requotes ?? 0),
        slippage: existing.slippage + (row.avgSlippagePoints ?? 0),
        latency: existing.latency + (row.avgExecutionLatencyMs ?? 0),
      });
    }

    const brokerRankings = Array.from(brokerMap.entries())
      .map(([broker, agg]) => ({
        brokerName: broker,
        avgQualityScore: Math.round(agg.totalScore / agg.count),
        totalRejections: agg.rejections,
        totalRequotes: agg.requotes,
        avgSlippagePoints: agg.count > 0 ? agg.slippage / agg.count : null,
        avgLatencyMs: agg.count > 0 ? agg.latency / agg.count : null,
        samplePeriods: agg.count,
      }))
      .sort((a, b) => b.avgQualityScore - a.avgQualityScore);

    return res.json({ quality: rows, brokerRankings });
  } catch (err) {
    req.log.error(err, "Execution quality list error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/risk/alerts ────────────────────────────────────────────

router.get("/risk/alerts", requireAdmin, async (req, res) => {
  try {
    const { userId, alertType, severity, unacknowledged } = req.query as Record<string, string | undefined>;
    const conditions = [];
    if (userId) conditions.push(eq(eaRiskAlertsTable.userId, userId));
    if (alertType) conditions.push(eq(eaRiskAlertsTable.alertType, alertType as EaRiskAlertType));
    if (severity) conditions.push(eq(eaRiskAlertsTable.severity, severity as "warning" | "critical"));
    if (unacknowledged === "true") conditions.push(eq(eaRiskAlertsTable.acknowledged, false));

    const rows = await db
      .select()
      .from(eaRiskAlertsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(eaRiskAlertsTable.createdAt))
      .limit(200);

    return res.json({ alerts: rows, total: rows.length });
  } catch (err) {
    req.log.error(err, "Risk alerts list error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

type EaRiskAlertType = "daily_drawdown" | "weekly_drawdown" | "margin_stress" | "exposure_concentration" | "abnormal_frequency";

// ─── POST /operational/risk/alerts/:id/acknowledge ───────────────────────────

router.post("/risk/alerts/:id/acknowledge", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    await db
      .update(eaRiskAlertsTable)
      .set({ acknowledged: true, acknowledgedAt: new Date() })
      .where(eq(eaRiskAlertsTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "Risk alert acknowledge error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/incidents ───────────────────────────────────────────────

router.get("/incidents", requireAdmin, async (req, res) => {
  try {
    const { status, category, severity } = req.query as Record<string, string | undefined>;
    const conditions = [];
    if (status) conditions.push(eq(operationalIncidentsTable.status, status as "INCIDENT_OPEN" | "INVESTIGATING" | "RESOLVED"));
    if (category) conditions.push(eq(operationalIncidentsTable.category, category as "BROKER" | "EA" | "SERVER" | "PAYMENT" | "MODEL" | "NETWORK"));
    if (severity) conditions.push(eq(operationalIncidentsTable.severity, severity as "low" | "medium" | "high" | "critical"));

    const rows = await db
      .select()
      .from(operationalIncidentsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(operationalIncidentsTable.createdAt))
      .limit(200);

    return res.json({ incidents: rows, total: rows.length });
  } catch (err) {
    req.log.error(err, "Incidents list error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /operational/incidents ─────────────────────────────────────────────

router.post("/incidents", requireAdmin, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const body = req.body as Record<string, unknown>;

    if (!body.title || !body.category || !body.severity) {
      return res.status(400).json({ error: "title, category, severity required" });
    }

    const [row] = await db
      .insert(operationalIncidentsTable)
      .values({
        title: body.title as string,
        description: typeof body.description === "string" ? body.description : null,
        category: body.category as "BROKER" | "EA" | "SERVER" | "PAYMENT" | "MODEL" | "NETWORK",
        status: (body.status as "INCIDENT_OPEN" | "INVESTIGATING" | "RESOLVED") ?? "INCIDENT_OPEN",
        severity: body.severity as "low" | "medium" | "high" | "critical",
        affectedUsersCount: typeof body.affectedUsersCount === "number" ? body.affectedUsersCount : 0,
        actorUserId: userId,
        metadata: body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : null,
      })
      .returning();

    if (row) broadcastOpsEvent("incident.updated", row);
    return res.status(201).json({ incident: row });
  } catch (err) {
    req.log.error(err, "Create incident error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /operational/incidents/:id ────────────────────────────────────────

router.patch("/incidents/:id", requireAdmin, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const body = req.body as Record<string, unknown>;
    const update: Record<string, unknown> = { updatedAt: new Date(), actorUserId: userId };
    if (typeof body.title === "string") update.title = body.title;
    if (typeof body.description === "string") update.description = body.description;
    if (typeof body.status === "string") {
      update.status = body.status;
      if (body.status === "RESOLVED") update.resolvedAt = new Date();
    }
    if (typeof body.severity === "string") update.severity = body.severity;
    if (typeof body.category === "string") update.category = body.category;
    if (typeof body.affectedUsersCount === "number") update.affectedUsersCount = body.affectedUsersCount;

    const [row] = await db
      .update(operationalIncidentsTable)
      .set(update as Partial<typeof operationalIncidentsTable.$inferInsert>)
      .where(eq(operationalIncidentsTable.id, id))
      .returning();

    if (!row) return res.status(404).json({ error: "Incident not found" });
    broadcastOpsEvent("incident.updated", row);
    return res.json({ incident: row });
  } catch (err) {
    req.log.error(err, "Update incident error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /operational/incidents/:id ───────────────────────────────────────

router.delete("/incidents/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    await db.delete(operationalIncidentsTable).where(eq(operationalIncidentsTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "Delete incident error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/alerts ──────────────────────────────────────────────────

router.get("/alerts", requireAdmin, async (req, res) => {
  try {
    const { type, severity, userId, unacknowledged, limit = "100" } = req.query as Record<string, string | undefined>;
    const conditions = [];
    if (type) conditions.push(eq(platformAlertsTable.type, type as typeof platformAlertsTable.$inferSelect["type"]));
    if (severity) conditions.push(eq(platformAlertsTable.severity, severity as "info" | "warning" | "critical"));
    if (userId) conditions.push(eq(platformAlertsTable.userId, userId));
    if (unacknowledged === "true") conditions.push(eq(platformAlertsTable.acknowledged, false));

    const rows = await db
      .select()
      .from(platformAlertsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(platformAlertsTable.createdAt))
      .limit(Math.min(500, parseInt(limit, 10)));

    const unackCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(platformAlertsTable)
      .where(eq(platformAlertsTable.acknowledged, false));

    // S23b: attach per-channel delivery status to each alert.
    const deliveryByAlert = new Map<number, { channel: string; status: string; detail: string | null }[]>();
    if (rows.length > 0) {
      const deliveryRows = await db
        .select()
        .from(alertDeliveryLogTable)
        .where(inArray(alertDeliveryLogTable.alertId, rows.map((r) => r.id)));
      for (const d of deliveryRows) {
        const list = deliveryByAlert.get(d.alertId) ?? [];
        list.push({ channel: d.channel, status: d.status, detail: d.detail });
        deliveryByAlert.set(d.alertId, list);
      }
    }
    const alertsWithDelivery = rows.map((r) => ({ ...r, delivery: deliveryByAlert.get(r.id) ?? [] }));

    return res.json({ alerts: alertsWithDelivery, total: rows.length, unacknowledgedCount: unackCount[0]?.count ?? 0 });
  } catch (err) {
    req.log.error(err, "Platform alerts list error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET/PATCH /operational/alert-channels — admin: delivery channel settings ─

router.get("/alert-channels", requireAdmin, async (req, res) => {
  try {
    const settings = await getAlertChannelSettings();
    return res.json({
      ...settings,
      telegramConfigured: Boolean(process.env["TELEGRAM_BOT_TOKEN"] && process.env["TELEGRAM_CHAT_ID"]),
      discordConfigured: Boolean(process.env["DISCORD_WEBHOOK_URL"]),
    });
  } catch (err) {
    req.log.error(err, "Alert channel settings fetch error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/alert-channels", requireAdmin, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const updates: Partial<typeof alertChannelSettingsTable.$inferInsert> = {};
    if (typeof body.emailEnabled === "boolean") updates.emailEnabled = body.emailEnabled;
    if (typeof body.telegramEnabled === "boolean") updates.telegramEnabled = body.telegramEnabled;
    if (typeof body.discordEnabled === "boolean") updates.discordEnabled = body.discordEnabled;
    if (Array.isArray(body.emailRecipients)) {
      const recipients = body.emailRecipients.filter((v): v is string => typeof v === "string" && v.includes("@"));
      updates.emailRecipients = recipients;
    }
    updates.updatedAt = new Date();

    await getAlertChannelSettings(); // ensure the singleton row exists
    const [updated] = await db
      .update(alertChannelSettingsTable)
      .set(updates)
      .where(eq(alertChannelSettingsTable.id, "global"))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Alert channel settings update error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/symbol-health — admin: per-symbol data health ──────────

router.get("/symbol-health", requireAdmin, async (req, res) => {
  try {
    const rows = await computeSymbolHealth();
    return res.json({ symbols: rows, generatedAt: new Date().toISOString() });
  } catch (err) {
    req.log.error(err, "Symbol health fetch error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /operational/alerts/:id/acknowledge ────────────────────────────────

router.post("/alerts/:id/acknowledge", requireAdmin, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    await db
      .update(platformAlertsTable)
      .set({ acknowledged: true, acknowledgedAt: new Date(), acknowledgedBy: userId })
      .where(eq(platformAlertsTable.id, id));

    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "Alert acknowledge error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/dashboard ───────────────────────────────────────────────

router.get("/dashboard", requireAdmin, async (req, res) => {
  try {
    const now = Date.now();
    const onlineThreshold = new Date(now - OFFLINE_THRESHOLD_MS);

    const [
      heartbeatRows,
      unackAlerts,
      openIncidents,
      criticalRiskAlerts,
    ] = await Promise.all([
      db.select().from(eaHeartbeatStatesTable),
      db.select({ count: sql<number>`count(*)::int` })
        .from(platformAlertsTable)
        .where(eq(platformAlertsTable.acknowledged, false)),
      db.select({ count: sql<number>`count(*)::int` })
        .from(operationalIncidentsTable)
        .where(ne(operationalIncidentsTable.status, "RESOLVED")),
      db.select({ count: sql<number>`count(*)::int` })
        .from(eaRiskAlertsTable)
        .where(and(eq(eaRiskAlertsTable.acknowledged, false), eq(eaRiskAlertsTable.severity, "critical"))),
    ]);

    // Count states accurately: time-derived OFFLINE overrides DB state
    const online = heartbeatRows.filter((r) => {
      if (!r.lastSeenAt) return false;
      const age = now - r.lastSeenAt.getTime();
      return age <= OFFLINE_THRESHOLD_MS / 2 && (r.state as string) === "ONLINE";
    }).length;
    const degraded = heartbeatRows.filter((r) => {
      if (!r.lastSeenAt) return false;
      const age = now - r.lastSeenAt.getTime();
      return age > OFFLINE_THRESHOLD_MS / 2 && age <= OFFLINE_THRESHOLD_MS;
    }).length;
    const offline = heartbeatRows.filter((r) =>
      !r.lastSeenAt || r.lastSeenAt <= onlineThreshold || (r.state as string) === "OFFLINE"
    ).length;
    const unauthorized = heartbeatRows.filter((r) => (r.state as string) === "UNAUTHORIZED").length;
    const outdated = heartbeatRows.filter((r) => (r.state as string) === "OUTDATED").length;

    // Recent telemetry for avg latency
    const latencyRows = await db
      .select({ vpsLatencyMs: eaTelemetrySnapshotsTable.vpsLatencyMs })
      .from(eaTelemetrySnapshotsTable)
      .where(gte(eaTelemetrySnapshotsTable.createdAt, new Date(now - 5 * 60_000)))
      .limit(500);
    const latencySamples = latencyRows.map((r) => r.vpsLatencyMs).filter((v): v is number => v !== null);
    const avgLatencyMs = latencySamples.length > 0
      ? Math.round(latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length)
      : null;

    return res.json({
      eaInstances: { online, offline, degraded, unauthorized, outdated, total: heartbeatRows.length },
      unacknowledgedAlerts: unackAlerts[0]?.count ?? 0,
      openIncidents: openIncidents[0]?.count ?? 0,
      criticalRiskAlerts: criticalRiskAlerts[0]?.count ?? 0,
      avgVpsLatencyMs: avgLatencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error(err, "Dashboard stats error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/support/user/:userId — staff-level user view ────────────

router.get("/support/user/:userId", requireStaff, async (req, res) => {
  try {
    const targetUserId = String(req.params["userId"] ?? "");
    if (!targetUserId) return res.status(400).json({ error: "userId required" });

    const heartbeats = await db.select().from(eaHeartbeatStatesTable)
      .where(eq(eaHeartbeatStatesTable.userId, targetUserId))
      .orderBy(desc(eaHeartbeatStatesTable.updatedAt));
    const recentTelemetry = await db.select().from(eaTelemetrySnapshotsTable)
      .where(eq(eaTelemetrySnapshotsTable.userId, targetUserId))
      .orderBy(desc(eaTelemetrySnapshotsTable.createdAt)).limit(20);
    const riskAlerts = await db.select().from(eaRiskAlertsTable)
      .where(and(eq(eaRiskAlertsTable.userId, targetUserId), eq(eaRiskAlertsTable.acknowledged, false)))
      .orderBy(desc(eaRiskAlertsTable.createdAt)).limit(10);
    const recentAlerts = await db.select().from(platformAlertsTable)
      .where(eq(platformAlertsTable.userId, targetUserId))
      .orderBy(desc(platformAlertsTable.createdAt)).limit(10);

    const latestTelemetry = recentTelemetry[0] ?? null;

    // Build safe view — no credentials, no internal keys
    return res.json({
      userId: targetUserId,
      eaInstances: heartbeats.map((h) => ({
        eaInstanceId: h.eaInstanceId,
        state: h.state,
        lastSeenAt: h.lastSeenAt,
        brokerName: h.brokerName,
        eaVersion: h.eaVersion,
        platformVersion: h.platformVersion,
      })),
      latestAccount: latestTelemetry ? {
        equity: latestTelemetry.equity,
        balance: latestTelemetry.balance,
        floatingPnL: latestTelemetry.floatingPnL,
        marginLevel: latestTelemetry.marginLevel,
        openPositionsCount: latestTelemetry.openPositionsCount,
        brokerName: latestTelemetry.brokerName,
        currentDrawdownPct: latestTelemetry.currentDrawdownPct,
        connectivityState: latestTelemetry.connectivityState,
        updatedAt: latestTelemetry.createdAt,
      } : null,
      activeRiskAlerts: riskAlerts,
      recentPlatformAlerts: recentAlerts,
    });
  } catch (err) {
    req.log.error(err, "Support user view error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/platform-health ────────────────────────────────────────
// S23a — latest + recent history of system-level health snapshots (CPU, RAM,
// event-loop lag, DB latency, Redis (not configured), WS connections, worker).

router.get("/platform-health", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(288, Math.max(1, parseInt(String(req.query["limit"] ?? "60"), 10) || 60));

    const [latest, history] = await Promise.all([
      getLatestSnapshot(),
      db
        .select()
        .from(platformHealthSnapshotsTable)
        .orderBy(desc(platformHealthSnapshotsTable.recordedAt))
        .limit(limit),
    ]);

    // history is already ordered newest-first (matches `latest`).
    return res.json({
      latest,
      history,
    });
  } catch (err) {
    req.log.error(err, "Platform health fetch error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/qde-runtime-health ─────────────────────────────────────
// S23a — QDE runtime signals derived live from opportunities/trade-timeline
// data: trade generation frequency, acceptance rate, avg holding duration,
// confidence distribution, and active autonomous vs. manual trader counts.

router.get("/qde-runtime-health", requireAdmin, async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60_000);

    const [
      generatedRow,
      enteredRow,
      confidenceRow,
      holdingRow,
      tradingModeRows,
    ] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(opportunitiesTable)
        .where(gte(opportunitiesTable.observedAt, since)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(opportunitiesTable)
        .where(and(gte(opportunitiesTable.observedAt, since), sql`${opportunitiesTable.enteredAt} is not null`)),
      db
        .select({ avgConfidence: sql<number | null>`avg(${opportunitiesTable.confidence})` })
        .from(opportunitiesTable)
        .where(and(gte(opportunitiesTable.observedAt, since), sql`${opportunitiesTable.confidence} is not null`)),
      db
        .select({ avgDurationSeconds: sql<number | null>`avg(${tradeTimelineTable.durationSeconds})` })
        .from(tradeTimelineTable)
        .where(and(gte(tradeTimelineTable.exitAt, since), sql`${tradeTimelineTable.durationSeconds} is not null`)),
      db
        .select({
          tradingMode: userTradingSettingsTable.tradingMode,
          count: sql<number>`count(*)::int`,
        })
        .from(userTradingSettingsTable)
        .groupBy(userTradingSettingsTable.tradingMode),
    ]);

    const generatedCount = generatedRow[0]?.count ?? 0;
    const enteredCount = enteredRow[0]?.count ?? 0;
    const acceptanceRate = generatedCount > 0 ? enteredCount / generatedCount : null;

    const modeCounts = { manual: 0, autonomous: 0 };
    for (const row of tradingModeRows) {
      if (row.tradingMode === "manual" || row.tradingMode === "autonomous") {
        modeCounts[row.tradingMode] = row.count;
      }
    }

    const activeDeployment = await db
      .select()
      .from(qdeDeploymentsTable)
      .where(eq(qdeDeploymentsTable.status, "active"))
      .orderBy(desc(qdeDeploymentsTable.activatedAt))
      .limit(1);

    return res.json({
      windowHours: 24,
      tradeGenerationFrequencyPerDay: generatedCount,
      tradeAcceptanceRate: acceptanceRate,
      avgConfidence: confidenceRow[0]?.avgConfidence ?? null,
      avgHoldingDurationSeconds: holdingRow[0]?.avgDurationSeconds ?? null,
      activeTraders: modeCounts,
      activeDeploymentVersion: activeDeployment[0]?.version ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error(err, "QDE runtime health fetch error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /operational/deployments/versions ───────────────────────────────────
// S23a — current version + git commit per service, plus deployment history
// for rollback reference. Display-only: does not trigger any rollback.

router.get("/deployments/versions", requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(serviceDeploymentsTable)
      .orderBy(desc(serviceDeploymentsTable.deployedAt))
      .limit(200);

    const current: Record<string, typeof rows[number] | null> = {
      frontend: null,
      backend: null,
      trainer: null,
    };
    for (const row of rows) {
      if (!current[row.service]) current[row.service] = row;
    }

    return res.json({ current, history: rows });
  } catch (err) {
    req.log.error(err, "Service deployment versions fetch error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /operational/deployments/versions ──────────────────────────────────
// S23a — admin: record a new deployment version for a service.

router.post("/deployments/versions", requireAdmin, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const service = body.service as string;
    if (!["frontend", "backend", "trainer"].includes(service)) {
      return res.status(400).json({ error: "service must be one of frontend, backend, trainer" });
    }
    if (typeof body.version !== "string" || !body.version.trim() || body.version.length > 100) {
      return res.status(400).json({ error: "version is required and must be at most 100 characters" });
    }
    if (typeof body.notes === "string" && body.notes.length > 2000) {
      return res.status(400).json({ error: "notes must be at most 2000 characters" });
    }
    if (typeof body.gitCommitHash === "string" && body.gitCommitHash.length > 100) {
      return res.status(400).json({ error: "gitCommitHash must be at most 100 characters" });
    }

    const [row] = await db
      .insert(serviceDeploymentsTable)
      .values({
        service: service as "frontend" | "backend" | "trainer",
        version: body.version.trim(),
        gitCommitHash: typeof body.gitCommitHash === "string" ? body.gitCommitHash.trim() : null,
        notes: typeof body.notes === "string" ? body.notes.trim() : null,
      })
      .returning();

    return res.status(201).json({ deployment: row });
  } catch (err) {
    req.log.error(err, "Record service deployment error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
