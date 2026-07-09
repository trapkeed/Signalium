/**
 * Background health-check sweep for market-data providers. Runs on an
 * interval (like AlertDetectors/PlatformHealth) so failures show up in
 * `provider_status` before they affect trading, instead of only being
 * visible when an admin manually clicks "Run Connectivity Check".
 */
import { db, dataProvidersTable, providerStatusTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../logger";
import { getAdapterForSlug } from "./registry";
import type { HealthCheckResult } from "./types";

/**
 * Runs a single provider's health probe and upserts the result into
 * `provider_status`. Shared by the manual admin "check now" endpoint and
 * the periodic sweep so both paths record identical, comparable data.
 */
export async function checkAndRecordProviderHealth(provider: {
  id: number;
  slug: string;
  apiEndpoint: string | null;
}): Promise<typeof providerStatusTable.$inferSelect> {
  const adapter = getAdapterForSlug(provider.slug);

  let result: HealthCheckResult;
  if (adapter) {
    result = await adapter.checkHealth();
  } else if (provider.apiEndpoint) {
    const start = Date.now();
    try {
      const resp = await fetch(provider.apiEndpoint, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
      result = { reachable: resp.status < 500, latencyMs: Date.now() - start, errorMessage: null };
    } catch (err) {
      result = { reachable: false, latencyMs: Date.now() - start, errorMessage: err instanceof Error ? err.message : "Connection failed" };
    }
  } else {
    result = { reachable: false, latencyMs: null, errorMessage: "No adapter or API endpoint configured" };
  }

  const [statusRow] = await db
    .insert(providerStatusTable)
    .values({
      providerId: provider.id,
      isReachable: result.reachable,
      lastCheckedAt: new Date(),
      lastSuccessAt: result.reachable ? new Date() : undefined,
      latencyMs: result.latencyMs ?? undefined,
      errorMessage: result.errorMessage,
      consecutiveFailures: result.reachable ? 0 : 1,
    })
    .onConflictDoUpdate({
      target: providerStatusTable.providerId,
      set: {
        isReachable: result.reachable,
        lastCheckedAt: new Date(),
        lastSuccessAt: result.reachable ? new Date() : undefined,
        consecutiveFailures: result.reachable ? 0 : sql`${providerStatusTable.consecutiveFailures} + 1`,
        latencyMs: result.latencyMs ?? undefined,
        errorMessage: result.errorMessage,
        updatedAt: new Date(),
      },
    })
    .returning();

  return statusRow;
}

let sweepInFlight = false;

export async function runMarketDataHealthSweep(): Promise<void> {
  if (sweepInFlight) return;
  sweepInFlight = true;
  try {
    const providers = await db.select().from(dataProvidersTable).where(eq(dataProvidersTable.isActive, true));
    for (const provider of providers) {
      try {
        await checkAndRecordProviderHealth(provider);
      } catch (err) {
        logger.warn({ err, provider: provider.slug }, "Market data health check failed");
      }
    }
  } finally {
    sweepInFlight = false;
  }
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function startMarketDataHealthSweep(intervalMs: number = 5 * 60_000): void {
  stopMarketDataHealthSweep();
  runMarketDataHealthSweep().catch((err) => logger.warn({ err }, "Initial market data health sweep failed"));
  sweepTimer = setInterval(() => {
    runMarketDataHealthSweep().catch((err) => logger.warn({ err }, "Market data health sweep failed"));
  }, intervalMs);
  logger.info({ intervalMs }, "MarketDataHealth: sweep started");
}

export function stopMarketDataHealthSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
