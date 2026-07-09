/**
 * S23b — Symbol Health Aggregation
 *
 * Computed live on read (no persisted snapshot table) — same "live-computed"
 * approach used for QDE runtime health in operational.ts, since these values
 * are cheap to derive from existing rows and a stale cached snapshot would
 * be actively misleading for an ops page.
 *
 * The platform has no candle/quote ingestion table yet (out of scope for
 * S23b — no new data-provider integrations). "Last data received" and "feed
 * latency" are therefore derived from `provider_status`, which is the most
 * recent real signal this schema has about a provider actually delivering
 * data — not a fabricated per-symbol candle timestamp.
 */

import { db } from "@workspace/db";
import {
  symbolsTable,
  symbolCategoriesTable,
  symbolAliasesTable,
  symbolNormalizationLogTable,
  providerSymbolMappingsTable,
  providerStatusTable,
  dataProvidersTable,
  brokersTable,
} from "@workspace/db";
import { eq, and, gte, sql, inArray } from "drizzle-orm";

export type SymbolSyncStatus = "synced" | "degraded" | "unsynced";
export type SymbolNormalizationStatus = "resolved" | "partial" | "unresolved" | "no_data";

export interface SymbolHealthRow {
  symbolId: number;
  canonicalSymbol: string;
  displayName: string;
  categoryId: number;
  enabled: boolean;
  syncStatus: SymbolSyncStatus;
  normalizationStatus: SymbolNormalizationStatus;
  normalizationResolvedRate: number | null;
  brokerMappingCoverage: number; // count of distinct brokers with an alias for this symbol
  totalActiveBrokers: number;
  lastDataAt: string | null; // most recent provider_status.lastSuccessAt among mapped providers
  feedLatencyMs: number | null; // min latencyMs among mapped, reachable providers
  mappedProviderCount: number;
  reachableProviderCount: number;
  qualityScore: number; // 0-100
}

const NORMALIZATION_WINDOW_MS = 7 * 24 * 60 * 60_000; // 7 days
const STALE_DATA_THRESHOLD_MS = 15 * 60_000; // 15 minutes without a successful provider sync

function computeQualityScore(input: {
  reachableProviderCount: number;
  mappedProviderCount: number;
  feedLatencyMs: number | null;
  lastDataAgeMs: number | null;
  normalizationResolvedRate: number | null;
  brokerMappingCoverage: number;
  totalActiveBrokers: number;
}): number {
  if (input.mappedProviderCount === 0) return 0; // no provider coverage at all

  let score = 100;

  // Reachability: any mapped provider unreachable is a real problem.
  const reachableRatio = input.reachableProviderCount / input.mappedProviderCount;
  score -= (1 - reachableRatio) * 40;

  // Staleness: no successful sync recently is a strong negative signal.
  if (input.lastDataAgeMs === null) score -= 30;
  else if (input.lastDataAgeMs > STALE_DATA_THRESHOLD_MS) {
    score -= Math.min(30, ((input.lastDataAgeMs - STALE_DATA_THRESHOLD_MS) / STALE_DATA_THRESHOLD_MS) * 15 + 10);
  }

  // Latency
  if (input.feedLatencyMs !== null) {
    if (input.feedLatencyMs > 2000) score -= Math.min(15, (input.feedLatencyMs - 2000) / 500);
    else if (input.feedLatencyMs > 500) score -= (input.feedLatencyMs - 500) / 300;
  }

  // Normalization health
  if (input.normalizationResolvedRate !== null) {
    score -= (1 - input.normalizationResolvedRate) * 10;
  }

  // Broker mapping coverage (soft signal — a symbol can be perfectly healthy
  // with zero broker aliases if no EA has reported it yet).
  if (input.totalActiveBrokers > 0) {
    const coverageRatio = input.brokerMappingCoverage / input.totalActiveBrokers;
    score -= (1 - coverageRatio) * 5;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function computeSymbolHealth(): Promise<SymbolHealthRow[]> {
  const [symbols, activeBrokerCountRow] = await Promise.all([
    db.select().from(symbolsTable),
    db.select({ count: sql<number>`count(*)::int` }).from(brokersTable).where(eq(brokersTable.isActive, true)),
  ]);
  if (symbols.length === 0) return [];

  const totalActiveBrokers = activeBrokerCountRow[0]?.count ?? 0;
  const symbolIds = symbols.map((s) => s.id);

  const [mappings, aliases, normLogs] = await Promise.all([
    db
      .select({
        canonicalSymbolId: providerSymbolMappingsTable.canonicalSymbolId,
        providerId: providerSymbolMappingsTable.providerId,
        isActive: providerSymbolMappingsTable.isActive,
        providerIsActive: dataProvidersTable.isActive,
        isReachable: providerStatusTable.isReachable,
        lastSuccessAt: providerStatusTable.lastSuccessAt,
        latencyMs: providerStatusTable.latencyMs,
      })
      .from(providerSymbolMappingsTable)
      .innerJoin(dataProvidersTable, eq(providerSymbolMappingsTable.providerId, dataProvidersTable.id))
      .leftJoin(providerStatusTable, eq(providerStatusTable.providerId, providerSymbolMappingsTable.providerId))
      .where(inArray(providerSymbolMappingsTable.canonicalSymbolId, symbolIds)),
    db
      .select({ symbolId: symbolAliasesTable.symbolId, brokerId: symbolAliasesTable.brokerId })
      .from(symbolAliasesTable)
      .where(inArray(symbolAliasesTable.symbolId, symbolIds)),
    db
      .select({
        resolvedSymbolId: symbolNormalizationLogTable.resolvedSymbolId,
        resolved: symbolNormalizationLogTable.resolved,
      })
      .from(symbolNormalizationLogTable)
      .where(
        and(
          gte(symbolNormalizationLogTable.createdAt, new Date(Date.now() - NORMALIZATION_WINDOW_MS)),
          inArray(symbolNormalizationLogTable.resolvedSymbolId, symbolIds),
        ),
      ),
  ]);

  const mappingsBySymbol = new Map<number, typeof mappings>();
  for (const m of mappings) {
    if (!m.isActive || !m.providerIsActive) continue;
    const list = mappingsBySymbol.get(m.canonicalSymbolId) ?? [];
    list.push(m);
    mappingsBySymbol.set(m.canonicalSymbolId, list);
  }

  const brokersBySymbol = new Map<number, Set<number>>();
  for (const a of aliases) {
    if (a.brokerId === null) continue;
    const set = brokersBySymbol.get(a.symbolId) ?? new Set<number>();
    set.add(a.brokerId);
    brokersBySymbol.set(a.symbolId, set);
  }

  const normBySymbol = new Map<number, { total: number; resolved: number }>();
  for (const n of normLogs) {
    if (n.resolvedSymbolId === null) continue;
    const agg = normBySymbol.get(n.resolvedSymbolId) ?? { total: 0, resolved: 0 };
    agg.total += 1;
    if (n.resolved) agg.resolved += 1;
    normBySymbol.set(n.resolvedSymbolId, agg);
  }

  const now = Date.now();

  return symbols.map((symbol) => {
    const symbolMappings = mappingsBySymbol.get(symbol.id) ?? [];
    const mappedProviderCount = symbolMappings.length;
    const reachableProviderCount = symbolMappings.filter((m) => m.isReachable).length;

    const lastSuccessTimes = symbolMappings.map((m) => m.lastSuccessAt).filter((v): v is Date => v !== null);
    const lastDataAt = lastSuccessTimes.length > 0
      ? new Date(Math.max(...lastSuccessTimes.map((d) => d.getTime())))
      : null;
    const lastDataAgeMs = lastDataAt ? now - lastDataAt.getTime() : null;

    const latencies = symbolMappings.filter((m) => m.isReachable).map((m) => m.latencyMs).filter((v): v is number => v !== null);
    const feedLatencyMs = latencies.length > 0 ? Math.min(...latencies) : null;

    let syncStatus: SymbolSyncStatus;
    if (mappedProviderCount === 0 || reachableProviderCount === 0) syncStatus = "unsynced";
    else if (reachableProviderCount < mappedProviderCount || (lastDataAgeMs !== null && lastDataAgeMs > STALE_DATA_THRESHOLD_MS)) syncStatus = "degraded";
    else syncStatus = "synced";

    const normAgg = normBySymbol.get(symbol.id) ?? null;
    const normalizationResolvedRate = normAgg && normAgg.total > 0 ? normAgg.resolved / normAgg.total : null;
    let normalizationStatus: SymbolNormalizationStatus;
    if (!normAgg || normAgg.total === 0) normalizationStatus = "no_data";
    else if (normalizationResolvedRate === 1) normalizationStatus = "resolved";
    else if (normalizationResolvedRate !== null && normalizationResolvedRate > 0) normalizationStatus = "partial";
    else normalizationStatus = "unresolved";

    const brokerMappingCoverage = brokersBySymbol.get(symbol.id)?.size ?? 0;

    const qualityScore = computeQualityScore({
      reachableProviderCount,
      mappedProviderCount,
      feedLatencyMs,
      lastDataAgeMs,
      normalizationResolvedRate,
      brokerMappingCoverage,
      totalActiveBrokers,
    });

    return {
      symbolId: symbol.id,
      canonicalSymbol: symbol.canonicalSymbol,
      displayName: symbol.displayName,
      categoryId: symbol.categoryId,
      enabled: symbol.enabled,
      syncStatus,
      normalizationStatus,
      normalizationResolvedRate,
      brokerMappingCoverage,
      totalActiveBrokers,
      lastDataAt: lastDataAt ? lastDataAt.toISOString() : null,
      feedLatencyMs,
      mappedProviderCount,
      reachableProviderCount,
      qualityScore,
    } satisfies SymbolHealthRow;
  });
}
