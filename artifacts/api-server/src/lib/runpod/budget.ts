/**
 * Task #4 — budget enforcement for RunPod pod launches. Refuses to launch a
 * pod that would exceed the configured max hourly cost or max active pod
 * count, so an admin can bound GPU spend from one place.
 */
import { db, runpodBudgetConfigTable, runpodPodsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

const ACTIVE_STATUSES = ["pending", "provisioning", "running", "restarting"] as const;

export async function getBudgetConfig() {
  const [row] = await db.select().from(runpodBudgetConfigTable);
  return (
    row ?? {
      id: "global",
      maxHourlyCostUsd: 10,
      maxActivePods: 2,
      autoShutdownIdleMinutes: null,
      updatedBy: null,
      updatedAt: new Date(),
    }
  );
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  currentActivePods: number;
  currentHourlyCostUsd: number;
}

/** Checks whether launching one more pod at `candidateCostPerHrUsd` would breach the configured budget. */
export async function checkBudgetForLaunch(candidateCostPerHrUsd: number): Promise<BudgetCheckResult> {
  const [config, activePods] = await Promise.all([
    getBudgetConfig(),
    db.select().from(runpodPodsTable).where(inArray(runpodPodsTable.status, [...ACTIVE_STATUSES])),
  ]);

  const currentActivePods = activePods.length;
  const currentHourlyCostUsd = activePods.reduce((sum, p) => sum + (p.lastReportedCostPerHrUsd ?? p.costPerHrUsd ?? 0), 0);

  if (currentActivePods + 1 > config.maxActivePods) {
    return {
      allowed: false,
      reason: `Launching would exceed the configured max active pods (${config.maxActivePods}).`,
      currentActivePods,
      currentHourlyCostUsd,
    };
  }

  if (currentHourlyCostUsd + candidateCostPerHrUsd > config.maxHourlyCostUsd) {
    return {
      allowed: false,
      reason: `Launching would exceed the configured max hourly cost ($${config.maxHourlyCostUsd}/hr).`,
      currentActivePods,
      currentHourlyCostUsd,
    };
  }

  return { allowed: true, currentActivePods, currentHourlyCostUsd };
}
