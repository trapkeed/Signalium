/**
 * Single point of truth for "which adapter backs this provider row" and
 * "which provider is currently active for a given role". Anything that
 * needs live/historical market data should resolve it through
 * `getActiveProvider()` rather than hardcoding a provider slug — swapping
 * the active source (or adding a new one) is then purely a DB/config change.
 */
import { db, dataProvidersTable, providerCapabilitiesTable, inferenceControlsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { MARKET_DATA_ADAPTERS } from "./adapters";
import type { MarketDataAdapter, MarketDataRole } from "./types";

const adapterBySlug = new Map(MARKET_DATA_ADAPTERS.map((a) => [a.slug, a]));

/** Looks up the adapter registered for a provider's slug, if any (generic/custom providers may have none). */
export function getAdapterForSlug(slug: string): MarketDataAdapter | null {
  return adapterBySlug.get(slug) ?? null;
}

export function listRegisteredAdapters(): MarketDataAdapter[] {
  return [...MARKET_DATA_ADAPTERS];
}

/**
 * Resolves the provider that should be used for a given role right now:
 * the admin's explicit `inference_controls.liveProviderId` pin takes
 * priority for the "live" role; otherwise falls back to the
 * highest-priority (lowest `priority` number) enabled provider that
 * declares the requested capability.
 */
export async function getActiveProvider(role: MarketDataRole): Promise<{
  providerId: number;
  slug: string;
  name: string;
  adapter: MarketDataAdapter | null;
} | null> {
  if (role === "live") {
    const [controls] = await db.select().from(inferenceControlsTable).where(eq(inferenceControlsTable.id, "global"));
    if (controls?.liveProviderId) {
      const [pinned] = await db
        .select()
        .from(dataProvidersTable)
        .where(and(eq(dataProvidersTable.id, controls.liveProviderId), eq(dataProvidersTable.isActive, true)));
      if (pinned) {
        return { providerId: pinned.id, slug: pinned.slug, name: pinned.name, adapter: getAdapterForSlug(pinned.slug) };
      }
    }
  }

  const rows = await db
    .select({
      id: dataProvidersTable.id,
      slug: dataProvidersTable.slug,
      name: dataProvidersTable.name,
      priority: dataProvidersTable.priority,
    })
    .from(dataProvidersTable)
    .innerJoin(
      providerCapabilitiesTable,
      and(eq(providerCapabilitiesTable.providerId, dataProvidersTable.id), eq(providerCapabilitiesTable.capabilityType, role)),
    )
    .where(eq(dataProvidersTable.isActive, true))
    .orderBy(dataProvidersTable.priority);

  const best = rows[0];
  if (!best) return null;
  return { providerId: best.id, slug: best.slug, name: best.name, adapter: getAdapterForSlug(best.slug) };
}
