/**
 * Budget enforcement for RunPod pod launches. Refuses to launch a pod that
 * would exceed the configured max hourly cost or max active pod count, so
 * an admin can bound GPU spend from one place.
 *
 * Caps live in the encrypted admin-secrets vault (vault-first, env fallback
 * via `resolveManagedConfig`) rather than a plain DB table — this keeps all
 * RunPod-related configuration (API key, GPU pricing, budget caps) in the
 * same vault-first store instead of splitting policy across two systems.
 */
import { db, adminSecretsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { runpodPodsTable } from "@workspace/db";
import { resolveManagedConfig } from "../secretsVault";
import { encryptSecret } from "../secretsVault";

const ACTIVE_STATUSES = ["pending", "provisioning", "running", "restarting"] as const;

const DEFAULT_MAX_HOURLY_COST_USD = 10;
const DEFAULT_MAX_ACTIVE_PODS = 2;

export interface RunpodBudgetConfig {
  maxHourlyCostUsd: number;
  maxActivePods: number;
  autoShutdownIdleMinutes: number | null;
}

export async function getBudgetConfig(): Promise<RunpodBudgetConfig> {
  const [maxHourlyCostUsdRaw, maxActivePodsRaw, autoShutdownIdleMinutesRaw] = await Promise.all([
    resolveManagedConfig("runpod.max_hourly_cost_usd", "RUNPOD_MAX_HOURLY_COST_USD"),
    resolveManagedConfig("runpod.max_active_pods", "RUNPOD_MAX_ACTIVE_PODS"),
    resolveManagedConfig("runpod.auto_shutdown_idle_minutes", "RUNPOD_AUTO_SHUTDOWN_IDLE_MINUTES"),
  ]);

  const maxHourlyCostUsd = maxHourlyCostUsdRaw !== null ? Number(maxHourlyCostUsdRaw) : DEFAULT_MAX_HOURLY_COST_USD;
  const maxActivePods = maxActivePodsRaw !== null ? Number(maxActivePodsRaw) : DEFAULT_MAX_ACTIVE_PODS;
  const autoShutdownIdleMinutes = autoShutdownIdleMinutesRaw !== null ? Number(autoShutdownIdleMinutesRaw) : null;

  return {
    maxHourlyCostUsd: Number.isFinite(maxHourlyCostUsd) ? maxHourlyCostUsd : DEFAULT_MAX_HOURLY_COST_USD,
    maxActivePods: Number.isFinite(maxActivePods) ? maxActivePods : DEFAULT_MAX_ACTIVE_PODS,
    autoShutdownIdleMinutes: autoShutdownIdleMinutes !== null && Number.isFinite(autoShutdownIdleMinutes) ? autoShutdownIdleMinutes : null,
  };
}

/** Upserts a single vault key, keeping RunPod budget config in the same encrypted store as the API key/GPU pricing. */
async function setVaultConfig(key: string, value: string, updatedBy: string): Promise<void> {
  const encryptedValue = encryptSecret(value);
  await db
    .insert(adminSecretsTable)
    .values({ key, encryptedValue, category: "other", description: "RunPod budget/config value", updatedBy })
    .onConflictDoUpdate({
      target: adminSecretsTable.key,
      set: { encryptedValue, updatedBy, updatedAt: new Date() },
    });
}

export async function setBudgetConfig(
  input: { maxHourlyCostUsd?: number; maxActivePods?: number; autoShutdownIdleMinutes?: number | null; gpuPricingJson?: Record<string, number> },
  updatedBy: string,
): Promise<RunpodBudgetConfig> {
  const writes: Promise<void>[] = [];
  if (input.maxHourlyCostUsd !== undefined) writes.push(setVaultConfig("runpod.max_hourly_cost_usd", String(input.maxHourlyCostUsd), updatedBy));
  if (input.maxActivePods !== undefined) writes.push(setVaultConfig("runpod.max_active_pods", String(input.maxActivePods), updatedBy));
  if (input.autoShutdownIdleMinutes !== undefined) {
    writes.push(setVaultConfig("runpod.auto_shutdown_idle_minutes", input.autoShutdownIdleMinutes === null ? "" : String(input.autoShutdownIdleMinutes), updatedBy));
  }
  if (input.gpuPricingJson !== undefined) {
    writes.push(setVaultConfig("runpod.gpu_pricing_json", JSON.stringify(input.gpuPricingJson), updatedBy));
  }
  await Promise.all(writes);
  return getBudgetConfig();
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
