/**
 * Broker-aware market data source resolution.
 *
 * Manual mode: the trainer/platform only ever uses external market-data
 * providers (OANDA, Tiingo, ...) resolved via the existing registry —
 * unchanged from before this feature.
 *
 * Autonomous mode: the connected EA becomes the primary live market data
 * source. This module walks the admin-configured `autonomousMarketPriority`
 * list (default: EA_FEED, then OANDA, then Tiingo) and returns the first
 * source that is actually healthy, so a disconnected/stale EA feed
 * automatically fails over to the next external provider. Every time a
 * user's resolved source changes, the switch is persisted and audit-logged.
 */
import { db, dataProvidersTable, providerStatusTable, eaTelemetrySnapshotsTable, eaHeartbeatStatesTable, inferenceControlsTable, userTradingSettingsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getActiveProvider, getAdapterForSlug } from "./registry";
import { logAudit } from "../auditLog";
import { logger } from "../logger";

export type MarketSource = "EXTERNAL_PROVIDER" | "EA_FEED" | "HYBRID";

/** EA feed telemetry is considered fresh (not stale/disconnected) within this window. */
const EA_FEED_FRESHNESS_MS = 90_000;

export interface ResolvedMarketSource {
  source: MarketSource;
  /** For EXTERNAL_PROVIDER/HYBRID: the provider slug/name currently serving data. */
  providerSlug: string | null;
  providerName: string | null;
  /** For EA_FEED/HYBRID: broker identity reported by the EA. */
  brokerServer: string | null;
  brokerCompany: string | null;
  feedHealth: "healthy" | "degraded" | "unavailable";
  lastTickAt: string | null;
  latencyMs: number | null;
}

async function getLatestEaTelemetry(userId: string) {
  const [row] = await db
    .select()
    .from(eaTelemetrySnapshotsTable)
    .where(eq(eaTelemetrySnapshotsTable.userId, userId))
    .orderBy(desc(eaTelemetrySnapshotsTable.createdAt))
    .limit(1);
  return row ?? null;
}

async function getEaHeartbeat(userId: string) {
  const [row] = await db
    .select()
    .from(eaHeartbeatStatesTable)
    .where(eq(eaHeartbeatStatesTable.userId, userId))
    .orderBy(desc(eaHeartbeatStatesTable.lastSeenAt))
    .limit(1);
  return row ?? null;
}

/** Is the EA feed fresh enough (recent tick + connected heartbeat) to be trusted as the primary market source? */
async function checkEaFeedHealth(userId: string): Promise<{ fresh: boolean; telemetry: Awaited<ReturnType<typeof getLatestEaTelemetry>>; heartbeat: Awaited<ReturnType<typeof getEaHeartbeat>> }> {
  const [telemetry, heartbeat] = await Promise.all([getLatestEaTelemetry(userId), getEaHeartbeat(userId)]);
  if (!telemetry) return { fresh: false, telemetry, heartbeat };

  const referenceTime = telemetry.tickTimestamp ?? telemetry.createdAt;
  const ageMs = Date.now() - new Date(referenceTime).getTime();
  const heartbeatOk = !heartbeat || heartbeat.state === "ONLINE" || heartbeat.state === "DEGRADED";
  const fresh = ageMs <= EA_FEED_FRESHNESS_MS && heartbeatOk && telemetry.connectivityState !== "disconnected";
  return { fresh, telemetry, heartbeat };
}

async function resolveExternalProviderSource(slug: string): Promise<ResolvedMarketSource | null> {
  const [provider] = await db.select().from(dataProvidersTable).where(eq(dataProvidersTable.slug, slug));
  if (!provider || !provider.isActive) return null;

  const [status] = await db.select().from(providerStatusTable).where(eq(providerStatusTable.providerId, provider.id));
  const adapter = getAdapterForSlug(provider.slug);
  const configured = adapter ? await adapter.isConfigured() : !!provider.apiEndpoint;
  if (!configured) return null;

  const reachable = status?.isReachable ?? null;
  return {
    source: "EXTERNAL_PROVIDER",
    providerSlug: provider.slug,
    providerName: provider.name,
    brokerServer: null,
    brokerCompany: null,
    feedHealth: reachable === true ? "healthy" : reachable === false ? "unavailable" : "degraded",
    lastTickAt: status?.lastCheckedAt ? status.lastCheckedAt.toISOString() : null,
    latencyMs: status?.latencyMs ?? null,
  };
}

async function resolveManualModeSource(): Promise<ResolvedMarketSource> {
  const active = await getActiveProvider("live");
  if (!active) {
    return {
      source: "EXTERNAL_PROVIDER",
      providerSlug: null,
      providerName: null,
      brokerServer: null,
      brokerCompany: null,
      feedHealth: "unavailable",
      lastTickAt: null,
      latencyMs: null,
    };
  }
  const resolved = await resolveExternalProviderSource(active.slug);
  return resolved ?? {
    source: "EXTERNAL_PROVIDER",
    providerSlug: active.slug,
    providerName: active.name,
    brokerServer: null,
    brokerCompany: null,
    feedHealth: "unavailable",
    lastTickAt: null,
    latencyMs: null,
  };
}

async function resolveAutonomousModeSource(userId: string): Promise<ResolvedMarketSource> {
  const [controls] = await db.select().from(inferenceControlsTable).where(eq(inferenceControlsTable.id, "global"));
  const priority = controls?.autonomousMarketPriority?.length ? controls.autonomousMarketPriority : ["EA_FEED", "oanda", "tiingo"];

  const { fresh, telemetry, heartbeat } = await checkEaFeedHealth(userId);

  for (const entry of priority) {
    if (entry === "EA_FEED") {
      if (!fresh) continue;
      const usesExternalSupplement = false; // reserved: symbol-level HYBRID detection happens at call sites that pass a symbol
      return {
        source: usesExternalSupplement ? "HYBRID" : "EA_FEED",
        providerSlug: null,
        providerName: null,
        brokerServer: telemetry?.brokerServer ?? null,
        brokerCompany: telemetry?.brokerCompany ?? telemetry?.brokerName ?? null,
        feedHealth: heartbeat?.state === "DEGRADED" ? "degraded" : "healthy",
        lastTickAt: (telemetry?.tickTimestamp ?? telemetry?.createdAt)?.toISOString() ?? null,
        latencyMs: telemetry?.vpsLatencyMs ?? null,
      };
    }

    const resolved = await resolveExternalProviderSource(entry);
    if (resolved && resolved.feedHealth !== "unavailable") return resolved;
  }

  // Nothing in the priority list is healthy — return the last external
  // provider entry (if any) marked unavailable rather than throwing, so the
  // dashboard can show a clear "no market data source available" state.
  const lastExternal = [...priority].reverse().find((e) => e !== "EA_FEED");
  if (lastExternal) {
    const resolved = await resolveExternalProviderSource(lastExternal);
    if (resolved) return resolved;
  }
  return {
    source: "EA_FEED",
    providerSlug: null,
    providerName: null,
    brokerServer: telemetry?.brokerServer ?? null,
    brokerCompany: telemetry?.brokerCompany ?? telemetry?.brokerName ?? null,
    feedHealth: "unavailable",
    lastTickAt: (telemetry?.tickTimestamp ?? telemetry?.createdAt)?.toISOString() ?? null,
    latencyMs: null,
  };
}

/**
 * Resolves the current market data source for a user, persists + audit-logs
 * a switch if it differs from the last resolved source, and returns the
 * resolution for display (dashboard widget) or trainer request annotation.
 */
export async function resolveMarketSourceForUser(userId: string): Promise<ResolvedMarketSource> {
  const [settings] = await db.select().from(userTradingSettingsTable).where(eq(userTradingSettingsTable.userId, userId));
  const tradingMode = settings?.tradingMode ?? "manual";

  const resolved = tradingMode === "autonomous" ? await resolveAutonomousModeSource(userId) : await resolveManualModeSource();

  const previousSource = settings?.lastMarketSource ?? null;
  if (previousSource !== resolved.source) {
    try {
      await db
        .insert(userTradingSettingsTable)
        .values({
          userId,
          tradingMode,
          lastMarketSource: resolved.source,
          lastMarketSourceAt: new Date(),
          lastMarketSourceDetail: { providerSlug: resolved.providerSlug, brokerServer: resolved.brokerServer },
        })
        .onConflictDoUpdate({
          target: userTradingSettingsTable.userId,
          set: {
            lastMarketSource: resolved.source,
            lastMarketSourceAt: new Date(),
            lastMarketSourceDetail: { providerSlug: resolved.providerSlug, brokerServer: resolved.brokerServer },
          },
        });

      // Only log a "switch" once there was a previous source to switch
      // from — the very first resolution for a user isn't a failover event.
      if (previousSource !== null) {
        await logAudit(userId, "market_source.switched", "user", userId, {
          from: previousSource,
          to: resolved.source,
          providerSlug: resolved.providerSlug,
          feedHealth: resolved.feedHealth,
        });
      }
    } catch (err) {
      logger.warn({ err, userId }, "Failed to persist/audit market source switch (non-fatal)");
    }
  }

  return resolved;
}
