/**
 * periodic polling of active RunPod pods for status/cost/
 * utilization, mirroring the marketData health-sweep pattern (health.ts).
 */
import { db, runpodPodsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { getPodStatus, isRunpodConfigured } from "./client";

const POLLABLE_STATUSES = ["pending", "provisioning", "running", "restarting", "stopped"] as const;

let sweepInFlight = false;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Maps RunPod's `desiredStatus` to our local status enum. RunPod is the
 * source of truth for whether a pod is actually running — the local status
 * we set optimistically on launch/stop/restart must be reconciled to this on
 * every poll, or the admin UI and cost accrual both drift from reality.
 */
function mapRunpodStatus(desiredStatus: string): (typeof runpodPodsTable.$inferSelect)["status"] | null {
  switch (desiredStatus.toUpperCase()) {
    case "RUNNING":
      return "running";
    case "EXITED":
    case "STOPPED":
      return "stopped";
    case "TERMINATED":
      return "terminated";
    case "RESTARTING":
      return "restarting";
    default:
      return null; // unrecognized RunPod status — leave local status untouched rather than guess
  }
}

export async function pollRunpodPod(podRowId: number): Promise<void> {
  const [pod] = await db.select().from(runpodPodsTable).where(eq(runpodPodsTable.id, podRowId));
  if (!pod || !pod.runpodPodId) return;

  try {
    const status = await getPodStatus(pod.runpodPodId);
    if (!status) {
      await db
        .update(runpodPodsTable)
        .set({ lastPolledAt: new Date(), lastError: "Pod not found on RunPod", updatedAt: new Date() })
        .where(eq(runpodPodsTable.id, podRowId));
      return;
    }

    const mappedStatus = mapRunpodStatus(status.desiredStatus);
    // Never resurrect a pod we've already terminated locally, even if
    // RunPod's status lags — terminal state is authoritative once reached.
    const nextStatus = pod.status === "terminated" ? pod.status : mappedStatus ?? pod.status;

    const costPerHr = status.costPerHr ?? pod.costPerHrUsd ?? 0;
    // Cost accrual is derived from RunPod's own reported uptime, not local
    // elapsed wall-clock time or local status — those can drift or be wrong
    // if a poll is missed or the pod was restarted outside our control.
    const uptimeSeconds = nextStatus === "running" ? status.runtime?.uptimeInSeconds ?? 0 : 0;
    const accruedCostUsd = nextStatus === "running" ? (costPerHr * uptimeSeconds) / 3600 : pod.accruedCostUsd;

    await db
      .update(runpodPodsTable)
      .set({
        status: nextStatus,
        lastReportedCostPerHrUsd: status.costPerHr,
        lastUtilizationPct: status.gpuUtilPercent,
        accruedCostUsd,
        lastPolledAt: new Date(),
        lastError: null,
        stoppedAt: nextStatus === "stopped" && pod.status !== "stopped" ? new Date() : pod.stoppedAt,
        updatedAt: new Date(),
      })
      .where(eq(runpodPodsTable.id, podRowId));
  } catch (err) {
    await db
      .update(runpodPodsTable)
      .set({ lastPolledAt: new Date(), lastError: err instanceof Error ? err.message : String(err), updatedAt: new Date() })
      .where(eq(runpodPodsTable.id, podRowId));
  }
}

export async function runRunpodMonitorSweep(): Promise<void> {
  if (sweepInFlight) return;
  sweepInFlight = true;
  try {
    if (!(await isRunpodConfigured())) return;
    const pods = await db.select().from(runpodPodsTable).where(inArray(runpodPodsTable.status, [...POLLABLE_STATUSES]));
    for (const pod of pods) {
      await pollRunpodPod(pod.id);
    }
  } catch (err) {
    logger.error(err, "RunpodMonitor: sweep failed");
  } finally {
    sweepInFlight = false;
  }
}

export function startRunpodMonitor(intervalMs = 60_000): void {
  if (sweepTimer) return;
  logger.info({ intervalMs }, "RunpodMonitor: sweep started");
  void runRunpodMonitorSweep();
  sweepTimer = setInterval(() => {
    void runRunpodMonitorSweep();
  }, intervalMs);
}
