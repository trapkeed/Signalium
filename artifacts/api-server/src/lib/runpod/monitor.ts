/**
 * Task #4 — periodic polling of active RunPod pods for status/cost/
 * utilization, mirroring the marketData health-sweep pattern (health.ts).
 */
import { db, runpodPodsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { getPodStatus, isRunpodConfigured } from "./client";

const POLLABLE_STATUSES = ["pending", "provisioning", "running", "restarting", "stopped"] as const;

let sweepInFlight = false;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

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

    const runningMs = pod.launchedAt ? Date.now() - pod.launchedAt.getTime() : 0;
    const costPerHr = status.costPerHr ?? pod.costPerHrUsd ?? 0;
    const accruedCostUsd = pod.status === "running" ? (costPerHr * runningMs) / 3_600_000 : pod.accruedCostUsd;

    await db
      .update(runpodPodsTable)
      .set({
        lastReportedCostPerHrUsd: status.costPerHr,
        lastUtilizationPct: status.gpuUtilPercent,
        accruedCostUsd,
        lastPolledAt: new Date(),
        lastError: null,
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
