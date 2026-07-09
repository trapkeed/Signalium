/**
 * S25 — Operations Dashboard aggregation
 *
 * Computed live on read (same "live-computed, no snapshot table" approach as
 * symbolHealth.ts / the QDE runtime-health endpoint) since every input here
 * is cheap to derive from existing rows and a cached snapshot would go stale
 * within the ops team's refresh interval anyway.
 *
 * Where the platform genuinely has no supporting infrastructure (a message
 * queue, a cache layer) this reports `configured: false` rather than
 * fabricating a number — same philosophy as platformHealth.ts's
 * `redisConfigured: false`.
 */
import { db } from "@workspace/db";
import {
  usersTable,
  subscriptionsTable,
  subscriptionEventsTable,
  plansTable,
  eaHeartbeatStatesTable,
  eaTelemetrySnapshotsTable,
  userTradingSettingsTable,
  tradeTimelineTable,
  tradeFailuresTable,
  symbolsTable,
  symbolCategoriesTable,
  platformAlertsTable,
  platformHealthSnapshotsTable,
} from "@workspace/db";
import { eq, and, gte, inArray, sql, desc } from "drizzle-orm";
import { getLatestSnapshot } from "./platformHealth";
import { computeSymbolHealth } from "./symbolHealth";
import { getApiResponseTimeStats } from "./apiResponseTime";

const OFFLINE_THRESHOLD_MS = 120_000;
const ONLINE_THRESHOLD_MS = OFFLINE_THRESHOLD_MS / 2;

/** Latest row per userId from a set of rows already ordered desc by recency. */
function latestPerUser<T extends { userId: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (!map.has(row.userId)) map.set(row.userId, row);
  }
  return map;
}

async function getUserMonitoring() {
  const now = Date.now();
  const onlineSince = new Date(now - ONLINE_THRESHOLD_MS);
  const dayAgo = new Date(now - 24 * 60 * 60_000);
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60_000);

  const [
    heartbeatRows,
    tradingModeRows,
    activeSubs,
    churnEvents,
    trialCreatedEvents,
    trialConvertedEvents,
  ] = await Promise.all([
    db.select({ userId: eaHeartbeatStatesTable.userId, state: eaHeartbeatStatesTable.state, lastSeenAt: eaHeartbeatStatesTable.lastSeenAt })
      .from(eaHeartbeatStatesTable),
    db.select({ userId: userTradingSettingsTable.userId, tradingMode: userTradingSettingsTable.tradingMode })
      .from(userTradingSettingsTable),
    db.select({ price: plansTable.priceMonthly, tier: plansTable.tier, userId: subscriptionsTable.userId })
      .from(subscriptionsTable)
      .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(inArray(subscriptionsTable.status, ["active", "grace_period"])),
    // Churn: subscriptions that expired/cancelled in the last 30 days.
    db.select({ count: sql<number>`count(*)::int` })
      .from(subscriptionEventsTable)
      .where(and(
        inArray(subscriptionEventsTable.eventType, ["SUBSCRIPTION_EXPIRED", "SUBSCRIPTION_CANCELLED"]),
        gte(subscriptionEventsTable.createdAt, thirtyDaysAgo),
      )),
    // Trial conversion is approximated: this schema has no dedicated trial
    // flag/period, so a subscription's very first lifecycle event landing in
    // PENDING_PAYMENT status stands in for "started a trial", and a
    // subsequent PAYMENT_CONFIRMED for that same subscription stands in for
    // "converted". This is a proxy, not an exact trial metric.
    db.select({ subscriptionId: subscriptionEventsTable.subscriptionId })
      .from(subscriptionEventsTable)
      .where(and(
        eq(subscriptionEventsTable.eventType, "SUBSCRIPTION_CREATED"),
        eq(subscriptionEventsTable.toStatus, "pending_payment"),
        gte(subscriptionEventsTable.createdAt, thirtyDaysAgo),
      )),
    db.select({ subscriptionId: subscriptionEventsTable.subscriptionId })
      .from(subscriptionEventsTable)
      .where(and(
        eq(subscriptionEventsTable.eventType, "PAYMENT_CONFIRMED"),
        gte(subscriptionEventsTable.createdAt, thirtyDaysAgo),
      )),
  ]);

  const onlineUserIds = new Set(
    heartbeatRows
      .filter((r) => r.state === "ONLINE" && r.lastSeenAt && r.lastSeenAt.getTime() >= onlineSince.getTime())
      .map((r) => r.userId),
  );
  const activeUserIds = new Set(
    heartbeatRows.filter((r) => r.lastSeenAt && r.lastSeenAt.getTime() >= dayAgo.getTime()).map((r) => r.userId),
  );

  const autonomousUserIds = new Set(
    tradingModeRows.filter((r) => r.tradingMode === "autonomous").map((r) => r.userId),
  );
  const activeAutonomousSessions = [...onlineUserIds].filter((id) => autonomousUserIds.has(id)).length;
  const activeManualSessions = [...onlineUserIds].filter((id) => !autonomousUserIds.has(id)).length;

  const revenueMonthly = activeSubs.reduce((sum, s) => sum + (s.price ?? 0), 0);
  const packageDistribution = activeSubs.reduce((acc: Record<string, number>, s) => {
    const tier = s.tier ?? "unknown";
    acc[tier] = (acc[tier] ?? 0) + 1;
    return acc;
  }, {});

  const churnedCount = churnEvents[0]?.count ?? 0;
  const activeCount = activeSubs.length;
  const churnRatePct = activeCount + churnedCount > 0 ? (churnedCount / (activeCount + churnedCount)) * 100 : 0;

  const trialStarted = new Set(trialCreatedEvents.map((e) => e.subscriptionId));
  const trialConvertedIds = new Set(trialConvertedEvents.map((e) => e.subscriptionId));
  const trialConverted = [...trialStarted].filter((id) => id !== null && trialConvertedIds.has(id)).length;
  const trialConversionRatePct = trialStarted.size > 0 ? (trialConverted / trialStarted.size) * 100 : null;

  return {
    activeUsers24h: activeUserIds.size,
    onlineUsersNow: onlineUserIds.size,
    activeAutonomousSessions,
    activeManualSessions,
    subscriptions: {
      active: activeCount,
      revenueMonthly,
      packageDistribution,
    },
    churn: {
      churned30d: churnedCount,
      churnRatePct: Math.round(churnRatePct * 10) / 10,
    },
    trialConversion: {
      note: "Approximated from subscription lifecycle events — this schema has no dedicated trial-period field.",
      trialsStarted30d: trialStarted.size,
      trialsConverted30d: trialConverted,
      conversionRatePct: trialConversionRatePct !== null ? Math.round(trialConversionRatePct * 10) / 10 : null,
    },
  };
}

async function getEaMonitoring() {
  const now = Date.now();
  const onlineThreshold = new Date(now - OFFLINE_THRESHOLD_MS);
  const fiveMinAgo = new Date(now - 5 * 60_000);

  const [heartbeatRows, recentTelemetry, symbolHealth] = await Promise.all([
    db.select().from(eaHeartbeatStatesTable),
    db.select({
      vpsLatencyMs: eaTelemetrySnapshotsTable.vpsLatencyMs,
      eaVersion: eaTelemetrySnapshotsTable.eaVersion,
      brokerName: eaTelemetrySnapshotsTable.brokerName,
      mt5BuildVersion: eaTelemetrySnapshotsTable.mt5BuildVersion,
      activeSymbols: eaTelemetrySnapshotsTable.activeSymbols,
      userId: eaTelemetrySnapshotsTable.userId,
      createdAt: eaTelemetrySnapshotsTable.createdAt,
    })
      .from(eaTelemetrySnapshotsTable)
      .where(gte(eaTelemetrySnapshotsTable.createdAt, new Date(now - 24 * 60 * 60_000)))
      .orderBy(desc(eaTelemetrySnapshotsTable.createdAt))
      .limit(2000),
    computeSymbolHealth(),
  ]);

  const online = heartbeatRows.filter((r) => r.lastSeenAt && now - r.lastSeenAt.getTime() <= ONLINE_THRESHOLD_MS && r.state === "ONLINE").length;
  const degraded = heartbeatRows.filter((r) => r.lastSeenAt && now - r.lastSeenAt.getTime() > ONLINE_THRESHOLD_MS && now - r.lastSeenAt.getTime() <= OFFLINE_THRESHOLD_MS).length;
  const offline = heartbeatRows.filter((r) => !r.lastSeenAt || r.lastSeenAt <= onlineThreshold || r.state === "OFFLINE").length;
  const lastHeartbeatAt = heartbeatRows.reduce<Date | null>((latest, r) => {
    if (!r.lastSeenAt) return latest;
    return !latest || r.lastSeenAt > latest ? r.lastSeenAt : latest;
  }, null);

  const recentSamples = recentTelemetry.filter((r) => r.createdAt >= fiveMinAgo);
  const latencySamples = recentSamples.map((r) => r.vpsLatencyMs).filter((v): v is number => v !== null);
  const avgVpsLatencyMs = latencySamples.length > 0
    ? Math.round(latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length)
    : null;

  const countBy = (rows: (string | null)[]) => rows.reduce((acc: Record<string, number>, v) => {
    const key = v ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  // De-dupe to the most recent snapshot per user so version/broker
  // distributions reflect the current fleet, not raw snapshot volume.
  const latestSnapshotByUser = latestPerUser(recentTelemetry);
  const latestRows = [...latestSnapshotByUser.values()];

  const symbolActivity: Record<string, number> = {};
  for (const row of latestRows) {
    for (const symbol of row.activeSymbols ?? []) {
      symbolActivity[symbol] = (symbolActivity[symbol] ?? 0) + 1;
    }
  }

  return {
    fleet: { online, offline, degraded, total: heartbeatRows.length },
    lastHeartbeatAt: lastHeartbeatAt?.toISOString() ?? null,
    eaVersionDistribution: countBy(latestRows.map((r) => r.eaVersion)),
    brokerDistribution: countBy(latestRows.map((r) => r.brokerName)),
    terminalBuildDistribution: countBy(latestRows.map((r) => r.mt5BuildVersion)),
    avgVpsLatencyMs,
    apiResponseTime: getApiResponseTimeStats(),
    symbolActivity24h: symbolActivity,
    symbolHealthSummary: {
      totalSymbols: symbolHealth.length,
      enabled: symbolHealth.filter((s) => s.enabled).length,
      synced: symbolHealth.filter((s) => s.syncStatus === "synced").length,
      degraded: symbolHealth.filter((s) => s.syncStatus === "degraded").length,
      unsynced: symbolHealth.filter((s) => s.syncStatus === "unsynced").length,
    },
  };
}

async function getAutonomousTradingMonitoring() {
  const now = Date.now();
  const tenMinAgo = new Date(now - 10 * 60_000);
  const dayAgo = new Date(now - 24 * 60 * 60_000);

  const [tradingModeRows, recentTelemetry, symbolCategoryRows, realizedPnlRows, drawdownAlertBaseline] = await Promise.all([
    db.select({ userId: userTradingSettingsTable.userId, tradingMode: userTradingSettingsTable.tradingMode })
      .from(userTradingSettingsTable)
      .where(eq(userTradingSettingsTable.tradingMode, "autonomous")),
    db.select({
      userId: eaTelemetrySnapshotsTable.userId,
      openPositionsCount: eaTelemetrySnapshotsTable.openPositionsCount,
      floatingPnL: eaTelemetrySnapshotsTable.floatingPnL,
      currentDrawdownPct: eaTelemetrySnapshotsTable.currentDrawdownPct,
      marginLevel: eaTelemetrySnapshotsTable.marginLevel,
      activeSymbols: eaTelemetrySnapshotsTable.activeSymbols,
      createdAt: eaTelemetrySnapshotsTable.createdAt,
    })
      .from(eaTelemetrySnapshotsTable)
      .where(gte(eaTelemetrySnapshotsTable.createdAt, tenMinAgo))
      .orderBy(desc(eaTelemetrySnapshotsTable.createdAt))
      .limit(2000),
    db.select({ canonicalSymbol: symbolsTable.canonicalSymbol, categoryName: symbolCategoriesTable.name })
      .from(symbolsTable)
      .innerJoin(symbolCategoriesTable, eq(symbolsTable.categoryId, symbolCategoriesTable.id)),
    db.select({ finalPnl: tradeTimelineTable.finalPnl, userId: tradeTimelineTable.userId })
      .from(tradeTimelineTable)
      .where(gte(tradeTimelineTable.exitAt, dayAgo)),
    // Platform-level health snapshots stand in for "is the trading system
    // operational" — see checkTrainerAvailability/checkDatabaseFailures for
    // the same signal used by the alert sweep. There is no dedicated
    // autonomous-engine uptime ledger, so this is an honest proxy, not a
    // precise SLA measurement.
    db.select({ dbHealthy: platformHealthSnapshotsTable.dbHealthy })
      .from(platformHealthSnapshotsTable)
      .where(gte(platformHealthSnapshotsTable.recordedAt, dayAgo))
      .orderBy(desc(platformHealthSnapshotsTable.recordedAt))
      .limit(500),
  ]);

  const autonomousUserIds = new Set(tradingModeRows.map((r) => r.userId));
  const autonomousSnapshots = recentTelemetry.filter((r) => autonomousUserIds.has(r.userId));
  const latestByUser = latestPerUser(autonomousSnapshots);
  const latestRows = [...latestByUser.values()];

  const activePositions = latestRows.reduce((sum, r) => sum + (r.openPositionsCount ?? 0), 0);
  const currentFloatingPnl = latestRows.reduce((sum, r) => sum + (r.floatingPnL ?? 0), 0);
  const realizedPnl24h = realizedPnlRows
    .filter((r) => autonomousUserIds.has(r.userId))
    .reduce((sum, r) => sum + (r.finalPnl ?? 0), 0);

  const symbolToCategory = new Map(symbolCategoryRows.map((r) => [r.canonicalSymbol, r.categoryName]));
  const exposureBySymbol: Record<string, number> = {};
  const exposureByAssetClass: Record<string, number> = {};
  for (const row of latestRows) {
    for (const symbol of row.activeSymbols ?? []) {
      exposureBySymbol[symbol] = (exposureBySymbol[symbol] ?? 0) + 1;
      const category = symbolToCategory.get(symbol) ?? "uncategorized";
      exposureByAssetClass[category] = (exposureByAssetClass[category] ?? 0) + 1;
    }
  }

  const drawdowns = latestRows.map((r) => r.currentDrawdownPct).filter((v): v is number => v !== null);
  const marginLevels = latestRows.map((r) => r.marginLevel).filter((v): v is number => v !== null);

  const healthySamples = drawdownAlertBaseline.filter((r) => r.dbHealthy).length;
  const autonomousEngineUptimePct = drawdownAlertBaseline.length > 0
    ? Math.round((healthySamples / drawdownAlertBaseline.length) * 1000) / 10
    : null;

  return {
    activeAutonomousUsers: autonomousUserIds.size,
    activePositions,
    exposure: {
      note: "Exposure counts are number of accounts currently holding an open position in the symbol/asset class — this schema has no per-position lot-size field to aggregate notional exposure.",
      bySymbol: exposureBySymbol,
      byAssetClass: exposureByAssetClass,
    },
    portfolioRisk: {
      avgDrawdownPct: drawdowns.length > 0 ? Math.round((drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length) * 10) / 10 : null,
      maxDrawdownPct: drawdowns.length > 0 ? Math.round(Math.max(...drawdowns) * 10) / 10 : null,
      accountsInCriticalDrawdown: drawdowns.filter((d) => d >= 10).length,
      avgMarginLevelPct: marginLevels.length > 0 ? Math.round(marginLevels.reduce((a, b) => a + b, 0) / marginLevels.length) : null,
    },
    pnl: {
      currentFloatingPnl: Math.round(currentFloatingPnl * 100) / 100,
      realizedPnl24h: Math.round(realizedPnl24h * 100) / 100,
    },
    autonomousEngineUptimePct,
  };
}

async function getInfrastructureMonitoring() {
  const latestHealth = await getLatestSnapshot();
  return {
    cpuUsagePct: latestHealth?.cpuUsagePct ?? null,
    memoryUsageMb: latestHealth?.memoryUsageMb ?? null,
    eventLoopLagMs: latestHealth?.eventLoopLagMs ?? null,
    dbLatencyMs: latestHealth?.dbLatencyMs ?? null,
    dbHealthy: latestHealth?.dbHealthy ?? null,
    activeWebsocketConnections: latestHealth?.activeWebsocketConnections ?? null,
    apiResponseTime: getApiResponseTimeStats(),
    recordedAt: latestHealth?.recordedAt?.toISOString() ?? null,
    // No message-queue or cache-layer infrastructure exists in this project
    // (confirmed alongside the Redis check in platformHealth.ts) — reported
    // honestly as unconfigured rather than fabricated.
    queue: { configured: false, note: "No message queue infrastructure is deployed." },
    cache: { configured: false, note: "No cache layer (e.g. Redis) is deployed." },
    websocketLatency: { configured: false, note: "Per-connection WS round-trip latency is not instrumented." },
    storage: { configured: false, note: "Object-storage utilization is not tracked in this project." },
  };
}

async function getAdminAlertsSummary() {
  const [unacknowledged, last24hByType] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` })
      .from(platformAlertsTable)
      .where(eq(platformAlertsTable.acknowledged, false)),
    db.select({ type: platformAlertsTable.type, severity: platformAlertsTable.severity, count: sql<number>`count(*)::int` })
      .from(platformAlertsTable)
      .where(gte(platformAlertsTable.createdAt, new Date(Date.now() - 24 * 60 * 60_000)))
      .groupBy(platformAlertsTable.type, platformAlertsTable.severity),
  ]);

  return {
    unacknowledged: unacknowledged[0]?.count ?? 0,
    last24hByType,
  };
}

export async function getOpsDashboardOverview() {
  const [userMonitoring, eaMonitoring, autonomousTradingMonitoring, infrastructure, alerts] = await Promise.all([
    getUserMonitoring(),
    getEaMonitoring(),
    getAutonomousTradingMonitoring(),
    getInfrastructureMonitoring(),
    getAdminAlertsSummary(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    userMonitoring,
    eaMonitoring,
    autonomousTradingMonitoring,
    infrastructure,
    alerts,
  };
}
