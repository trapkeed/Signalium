/**
 * S23a — Platform Health Monitor
 *
 * Samples system-level health metrics for the API server process on an
 * interval and flushes them to `platform_health_snapshots`. Follows the same
 * "in-memory sample, periodic flush" pattern used by the deployment manager's
 * health window.
 *
 * Redis is not currently part of the platform's infrastructure (confirmed:
 * no Redis/BullMQ usage anywhere in the repo) — redis fields are reported as
 * `redisConfigured: false` / `redisLatencyMs: null` rather than faked.
 */

import { db, platformHealthSnapshotsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import os from "os";
import { performance } from "perf_hooks";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { getActiveConnections } from "../ws/eaGateway";

let lastCpuUsage = process.cpuUsage();
let lastCpuSampleAt = Date.now();
let lastSchedulerRunAt: Date | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let captureInFlight = false;

/** Called by background jobs (deployment poll, health flush) to prove the scheduler is alive. */
export function markSchedulerHeartbeat(): void {
  lastSchedulerRunAt = new Date();
}

/** Measures event-loop lag by comparing an immediate-setTimeout's actual vs. expected delay. */
function measureEventLoopLagMs(): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    setTimeout(() => resolve(performance.now() - start), 0);
  });
}

/** Rough process-relative CPU usage percentage since the last sample. */
function sampleCpuUsagePct(): number | null {
  const now = Date.now();
  const elapsedMs = now - lastCpuSampleAt;
  if (elapsedMs <= 0) return null;

  const usage = process.cpuUsage(lastCpuUsage);
  lastCpuUsage = process.cpuUsage();
  lastCpuSampleAt = now;

  const usedMicros = usage.user + usage.system;
  const totalMicros = elapsedMs * 1000 * os.cpus().length;
  if (totalMicros <= 0) return null;
  return Math.min(100, (usedMicros / totalMicros) * 100);
}

async function measureDbLatencyMs(): Promise<{ latencyMs: number | null; healthy: boolean }> {
  const start = performance.now();
  try {
    await pool.query("SELECT 1");
    return { latencyMs: performance.now() - start, healthy: true };
  } catch (err) {
    logger.warn({ err }, "PlatformHealth: DB latency probe failed");
    return { latencyMs: null, healthy: false };
  }
}

export async function captureSnapshot(): Promise<void> {
  // Guard against overlapping runs if a probe (e.g. DB latency) stalls
  // longer than the sampling interval.
  if (captureInFlight) return;
  captureInFlight = true;
  try {
    const [eventLoopLagMs, dbProbe] = await Promise.all([
      measureEventLoopLagMs(),
      measureDbLatencyMs(),
    ]);

    const mem = process.memoryUsage();
    const cpuUsagePct = sampleCpuUsagePct();

    // Scheduler is considered healthy if it has run within the last 15
    // minutes (3x the 5-minute deployment-poll/health-flush interval).
    const schedulerHealthy = lastSchedulerRunAt
      ? Date.now() - lastSchedulerRunAt.getTime() < 15 * 60_000
      : false;

    await db.insert(platformHealthSnapshotsTable).values({
      cpuUsagePct,
      memoryUsageMb: mem.rss / 1_048_576,
      memoryTotalMb: os.totalmem() / 1_048_576,
      eventLoopLagMs,
      dbLatencyMs: dbProbe.latencyMs,
      dbHealthy: dbProbe.healthy,
      redisLatencyMs: null,
      redisConfigured: false,
      activeWebsocketConnections: getActiveConnections().size,
      schedulerLastRunAt: lastSchedulerRunAt,
      workerHealthy: schedulerHealthy,
    });
  } catch (err) {
    logger.warn({ err }, "PlatformHealth: failed to capture snapshot");
  } finally {
    captureInFlight = false;
  }
}

/** Starts periodic health-snapshot collection. Safe to call once at server startup. */
export function startPlatformHealthMonitor(intervalMs: number = 60_000): void {
  stopPlatformHealthMonitor();
  // Take an immediate sample so the dashboard isn't empty on a fresh boot.
  captureSnapshot().catch(() => {});
  flushTimer = setInterval(() => {
    captureSnapshot().catch(() => {});
  }, intervalMs);
  logger.info({ intervalMs }, "PlatformHealth: monitor started");
}

export function stopPlatformHealthMonitor(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

export async function getLatestSnapshot() {
  const [row] = await db
    .select()
    .from(platformHealthSnapshotsTable)
    .orderBy(desc(platformHealthSnapshotsTable.recordedAt))
    .limit(1);
  return row ?? null;
}
