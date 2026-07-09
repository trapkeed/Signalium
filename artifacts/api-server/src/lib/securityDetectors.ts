/**
 * S23c — Security detectors: periodic sweep for conditions that can't be
 * caught inline at request time (event-driven checks — brute-force auth,
 * invalid webhook signatures, excessive EA/API request rate — live in
 * requireApiKeyAuth.ts / payment-webhooks.ts instead). Mirrors S23b's
 * alertDetectors.ts sweep shape, but emits security_incidents rather than
 * platform_alerts.
 */
import { db, trainerActionsTable, loginEventsTable } from "@workspace/db";
import { and, gte, ne, sql } from "drizzle-orm";
import { emitSecurityIncident } from "./securityIncidents";
import { logger } from "./logger";

const RECENT_WINDOW_MS = 60 * 60_000; // last hour
const BASELINE_WINDOW_MS = 7 * 24 * 60 * 60_000; // trailing 7 days
const MIN_RECENT_ACTIONS = 10; // ignore low-volume noise
const SPIKE_MULTIPLIER = 3; // flag when recent hourly rate is 3x the trailing baseline hourly rate

// S28 — compliance-driven login anomaly detection: a cluster of suspicious
// (new-device + unrecognized-country, see account-security.ts) sign-ins for
// the same user in a short window is a stronger signal than any single one —
// isolated new-device logins already get a per-event email, this sweep flags
// the pattern that a single event can't see.
const LOGIN_ANOMALY_WINDOW_MS = 24 * 60 * 60_000; // last 24 hours
const LOGIN_ANOMALY_THRESHOLD = 3; // 3+ suspicious logins in the window

/**
 * Flags users whose non-HOLD trainer-action rate in the last hour is a
 * significant spike versus their own trailing 7-day hourly average — a
 * simple per-user heuristic for "abnormal trading activity", not ML-based
 * anomaly detection (explicitly out of scope).
 */
async function checkAbnormalTradingActivity(): Promise<void> {
  const now = Date.now();
  const recentSince = new Date(now - RECENT_WINDOW_MS);
  const baselineSince = new Date(now - BASELINE_WINDOW_MS);

  const recentRows = await db
    .select({ userId: trainerActionsTable.userId, count: sql<number>`count(*)::int` })
    .from(trainerActionsTable)
    .where(and(gte(trainerActionsTable.createdAt, recentSince), ne(trainerActionsTable.action, "HOLD")))
    .groupBy(trainerActionsTable.userId);

  if (recentRows.length === 0) return;

  const baselineRows = await db
    .select({ userId: trainerActionsTable.userId, count: sql<number>`count(*)::int` })
    .from(trainerActionsTable)
    .where(and(gte(trainerActionsTable.createdAt, baselineSince), ne(trainerActionsTable.action, "HOLD")))
    .groupBy(trainerActionsTable.userId);
  const baselineHourlyRateByUser = new Map(
    baselineRows.map((r) => [r.userId, r.count / (BASELINE_WINDOW_MS / 3_600_000)]),
  );

  for (const { userId, count: recentCount } of recentRows) {
    if (recentCount < MIN_RECENT_ACTIONS) continue;
    const baselineHourlyRate = baselineHourlyRateByUser.get(userId) ?? 0;
    // A user with no meaningful baseline yet (new/rarely-active) isn't a
    // useful spike comparison — require some prior activity to compare against.
    if (baselineHourlyRate < 0.5) continue;
    if (recentCount < baselineHourlyRate * SPIKE_MULTIPLIER) continue;

    await emitSecurityIncident({
      type: "abnormal_trading_activity",
      severity: recentCount >= baselineHourlyRate * SPIKE_MULTIPLIER * 2 ? "high" : "medium",
      message: `User ${userId} issued ${recentCount} trading actions in the last hour, ~${(recentCount / baselineHourlyRate).toFixed(1)}x their trailing 7-day average`,
      userId,
      detail: { recentCount, baselineHourlyRate },
      dedupWindowMs: RECENT_WINDOW_MS,
    });
  }
}

/**
 * Flags users with a cluster of suspicious logins (new device + unrecognized
 * country) in the trailing window — see account-security.ts sync-login for
 * how isSuspicious is computed per event.
 */
async function checkLoginAnomalies(): Promise<void> {
  const since = new Date(Date.now() - LOGIN_ANOMALY_WINDOW_MS);

  const rows = await db
    .select({ userId: loginEventsTable.userId, count: sql<number>`count(*)::int` })
    .from(loginEventsTable)
    .where(and(gte(loginEventsTable.occurredAt, since), sql`${loginEventsTable.isSuspicious} = true`))
    .groupBy(loginEventsTable.userId);

  for (const { userId, count } of rows) {
    if (count < LOGIN_ANOMALY_THRESHOLD) continue;
    await emitSecurityIncident({
      type: "login_anomaly_cluster",
      severity: count >= LOGIN_ANOMALY_THRESHOLD * 2 ? "high" : "medium",
      message: `User ${userId} had ${count} suspicious sign-ins (new device + unrecognized country) in the last 24 hours`,
      userId,
      detail: { count, windowMs: LOGIN_ANOMALY_WINDOW_MS },
      dedupWindowMs: LOGIN_ANOMALY_WINDOW_MS,
    });
  }
}

let sweepInFlight = false;

export async function runSecuritySweep(): Promise<void> {
  if (sweepInFlight) {
    logger.warn("SecurityDetectors: skipping sweep — previous sweep still in flight");
    return;
  }
  sweepInFlight = true;
  try {
    const detectors = [checkAbnormalTradingActivity, checkLoginAnomalies];
    for (const detector of detectors) {
      try {
        await detector();
      } catch (err) {
        logger.warn({ err, detector: detector.name }, "Security detector failed");
      }
    }
  } finally {
    sweepInFlight = false;
  }
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function startSecuritySweep(intervalMs: number = 5 * 60_000): void {
  stopSecuritySweep();
  runSecuritySweep().catch((err) => logger.warn({ err }, "Initial security sweep failed"));
  sweepTimer = setInterval(() => {
    runSecuritySweep().catch((err) => logger.warn({ err }, "Security sweep failed"));
  }, intervalMs);
  logger.info({ intervalMs }, "SecurityDetectors: sweep started");
}

export function stopSecuritySweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
