/**
 * S23b — Alerting Engine: periodic detectors
 *
 * A single interval sweep checks each condition and emits a platform alert
 * (deduped against any still-open alert of the same type within a cooldown
 * window) when a condition is breached. Every detector is defensive: a
 * failure in one must never prevent the others from running.
 */

import { db } from "@workspace/db";
import {
  qdeDeploymentsTable,
  qdeDeploymentHealthTable,
  platformHealthSnapshotsTable,
  webhookEventsTable,
  providerStatusTable,
  dataProvidersTable,
} from "@workspace/db";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { emitPlatformAlert, hasRecentPlatformAlert } from "./alerting";
import { getTrainerFailureState } from "./qdeTrainer";
import { computeSymbolHealth } from "./symbolHealth";
import { logger } from "./logger";

// Cooldown before re-alerting on the same condition — long enough to avoid
// spamming ops on every sweep, short enough that a resolved-then-recurring
// issue still gets a fresh alert.
const DEDUP_WINDOW_MS = 30 * 60_000; // 30 minutes

async function checkTrainerAvailability(): Promise<void> {
  const { consecutiveFailures, lastFailureAt } = getTrainerFailureState();
  if (consecutiveFailures < 3) return;
  if (await hasRecentPlatformAlert("trainer_unavailable", DEDUP_WINDOW_MS)) return;

  await emitPlatformAlert({
    type: "trainer_unavailable",
    severity: consecutiveFailures >= 10 ? "critical" : "warning",
    message: `QDE trainer has failed ${consecutiveFailures} consecutive decision requests (last failure ${lastFailureAt?.toISOString() ?? "unknown"})`,
  });
}

async function checkInferenceFailures(): Promise<void> {
  const [activeDeployment] = await db
    .select()
    .from(qdeDeploymentsTable)
    .where(eq(qdeDeploymentsTable.status, "active"))
    .orderBy(desc(qdeDeploymentsTable.activatedAt))
    .limit(1);
  if (!activeDeployment) return;

  const [latestHealth] = await db
    .select()
    .from(qdeDeploymentHealthTable)
    .where(eq(qdeDeploymentHealthTable.deploymentId, activeDeployment.id))
    .orderBy(desc(qdeDeploymentHealthTable.recordedAt))
    .limit(1);
  if (!latestHealth || latestHealth.sampleCount === 0) return;

  if (latestHealth.errorRate !== null && latestHealth.errorRate > 0.05) {
    if (await hasRecentPlatformAlert("inference_failure", DEDUP_WINDOW_MS)) return;
    await emitPlatformAlert({
      type: "inference_failure",
      severity: latestHealth.errorRate > 0.2 ? "critical" : "warning",
      message: `Active deployment ${activeDeployment.version} error rate ${(latestHealth.errorRate * 100).toFixed(1)}% over last health window (${latestHealth.sampleCount} samples)`,
      metadata: { deploymentId: activeDeployment.id, errorRate: latestHealth.errorRate },
    });
  }
}

async function checkExcessiveLatency(): Promise<void> {
  const [latestPlatformHealth] = await db
    .select()
    .from(platformHealthSnapshotsTable)
    .orderBy(desc(platformHealthSnapshotsTable.recordedAt))
    .limit(1);

  const [activeDeployment] = await db
    .select()
    .from(qdeDeploymentsTable)
    .where(eq(qdeDeploymentsTable.status, "active"))
    .orderBy(desc(qdeDeploymentsTable.activatedAt))
    .limit(1);
  const [latestHealth] = activeDeployment
    ? await db
        .select()
        .from(qdeDeploymentHealthTable)
        .where(eq(qdeDeploymentHealthTable.deploymentId, activeDeployment.id))
        .orderBy(desc(qdeDeploymentHealthTable.recordedAt))
        .limit(1)
    : [];

  const eventLoopLagMs = latestPlatformHealth?.eventLoopLagMs ?? null;
  const p95Ms = latestHealth?.latencyP95Ms ?? null;

  const eventLoopBreach = eventLoopLagMs !== null && eventLoopLagMs > 500;
  const inferenceLatencyBreach = p95Ms !== null && p95Ms > 3000;
  if (!eventLoopBreach && !inferenceLatencyBreach) return;
  if (await hasRecentPlatformAlert("excessive_latency", DEDUP_WINDOW_MS)) return;

  const parts: string[] = [];
  if (eventLoopBreach) parts.push(`event-loop lag ${eventLoopLagMs!.toFixed(0)}ms`);
  if (inferenceLatencyBreach) parts.push(`inference P95 ${p95Ms!.toFixed(0)}ms`);

  await emitPlatformAlert({
    type: "excessive_latency",
    severity: (eventLoopLagMs ?? 0) > 2000 || (p95Ms ?? 0) > 8000 ? "critical" : "warning",
    message: `Excessive latency detected: ${parts.join(", ")}`,
  });
}

async function checkDatabaseFailures(): Promise<void> {
  const [latest] = await db
    .select()
    .from(platformHealthSnapshotsTable)
    .orderBy(desc(platformHealthSnapshotsTable.recordedAt))
    .limit(1);
  if (!latest || latest.dbHealthy) return;
  if (await hasRecentPlatformAlert("database_failure", DEDUP_WINDOW_MS)) return;

  await emitPlatformAlert({
    type: "database_failure",
    severity: "critical",
    message: "Database latency probe failed on the most recent platform-health sample",
  });
}

async function checkPaymentFailures(): Promise<void> {
  const since = new Date(Date.now() - DEDUP_WINDOW_MS);
  const [failedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(webhookEventsTable)
    .where(and(eq(webhookEventsTable.status, "failed"), gte(webhookEventsTable.receivedAt, since)));
  const failedCount = failedRow?.count ?? 0;
  if (failedCount < 3) return;
  if (await hasRecentPlatformAlert("payment_failure", DEDUP_WINDOW_MS)) return;

  await emitPlatformAlert({
    type: "payment_failure",
    severity: failedCount >= 10 ? "critical" : "warning",
    message: `${failedCount} payment webhook events failed in the last 30 minutes`,
  });
}

async function checkDataProviderOutages(): Promise<void> {
  const rows = await db
    .select({
      providerId: providerStatusTable.providerId,
      name: dataProvidersTable.name,
      isReachable: providerStatusTable.isReachable,
      consecutiveFailures: providerStatusTable.consecutiveFailures,
    })
    .from(providerStatusTable)
    .innerJoin(dataProvidersTable, eq(dataProvidersTable.id, providerStatusTable.providerId))
    .where(eq(dataProvidersTable.isActive, true));

  const outages = rows.filter((r) => !r.isReachable && r.consecutiveFailures >= 3);
  if (outages.length === 0) return;
  if (await hasRecentPlatformAlert("data_provider_outage", DEDUP_WINDOW_MS)) return;

  await emitPlatformAlert({
    type: "data_provider_outage",
    severity: outages.length > 1 ? "critical" : "warning",
    message: `${outages.length} active data provider(s) unreachable: ${outages.map((o) => o.name).join(", ")}`,
    metadata: { providerIds: outages.map((o) => o.providerId) },
  });
}

async function checkAbnormalMarketConditions(): Promise<void> {
  const symbolHealth = await computeSymbolHealth();
  const enabled = symbolHealth.filter((s) => s.enabled);
  if (enabled.length === 0) return;

  const unhealthy = enabled.filter((s) => s.syncStatus !== "synced");
  const unhealthyRatio = unhealthy.length / enabled.length;
  if (unhealthyRatio < 0.5) return;
  if (await hasRecentPlatformAlert("abnormal_market_condition", DEDUP_WINDOW_MS)) return;

  await emitPlatformAlert({
    type: "abnormal_market_condition",
    severity: unhealthyRatio >= 0.8 ? "critical" : "warning",
    message: `${unhealthy.length}/${enabled.length} enabled symbols are not fully synced — possible feed-wide disruption`,
  });
}

// Reentrancy guard: if a sweep is still running when the next interval
// fires (e.g. a slow DB), skip the new one rather than letting two sweeps
// run concurrently — concurrent sweeps would each pass the dedup check
// before either alert insert is visible to the other, producing duplicate
// alerts/delivery spam. Mirrors the interval-reentrancy pattern used by the
// S23a platform-health monitor.
let sweepInFlight = false;

export async function runAlertSweep(): Promise<void> {
  if (sweepInFlight) {
    logger.warn("AlertDetectors: skipping sweep — previous sweep still in flight");
    return;
  }
  sweepInFlight = true;
  try {
    const detectors = [
      checkTrainerAvailability,
      checkInferenceFailures,
      checkExcessiveLatency,
      checkDatabaseFailures,
      checkPaymentFailures,
      checkDataProviderOutages,
      checkAbnormalMarketConditions,
    ];
    for (const detector of detectors) {
      try {
        await detector();
      } catch (err) {
        logger.warn({ err, detector: detector.name }, "Alert detector failed");
      }
    }
  } finally {
    sweepInFlight = false;
  }
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function startAlertSweep(intervalMs: number = 2 * 60_000): void {
  stopAlertSweep();
  runAlertSweep().catch((err) => logger.warn({ err }, "Initial alert sweep failed"));
  sweepTimer = setInterval(() => {
    runAlertSweep().catch((err) => logger.warn({ err }, "Alert sweep failed"));
  }, intervalMs);
  logger.info({ intervalMs }, "AlertDetectors: sweep started");
}

export function stopAlertSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
