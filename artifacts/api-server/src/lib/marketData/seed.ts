/**
 * Idempotently seeds the data_providers table with OANDA (live) and Tiingo
 * (historical) as the initially-enabled, real providers, plus every other
 * named provider from the registry as disabled stubs so admins see the full
 * roster immediately without having to create rows by hand.
 */
import { db, dataProvidersTable, providerCapabilitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { MARKET_DATA_ADAPTERS } from "./adapters";

const INITIAL_CAPABILITY: Record<string, "live" | "historical" | undefined> = {
  oanda: "live",
  tiingo: "historical",
};

export async function seedMarketDataProviders(): Promise<void> {
  let priority = 0;
  for (const adapter of MARKET_DATA_ADAPTERS) {
    const [existing] = await db.select().from(dataProvidersTable).where(eq(dataProvidersTable.slug, adapter.slug));

    const isPrimary = adapter.slug === "oanda" || adapter.slug === "tiingo";
    let providerId: number;
    if (existing) {
      providerId = existing.id;
    } else {
      const [created] = await db
        .insert(dataProvidersTable)
        .values({
          name: adapter.name,
          slug: adapter.slug,
          isActive: isPrimary,
          priority: priority++,
        })
        .returning();
      providerId = created.id;
    }

    const capabilityType = INITIAL_CAPABILITY[adapter.slug];
    if (capabilityType) {
      await db
        .insert(providerCapabilitiesTable)
        .values({ providerId, capabilityType })
        .onConflictDoNothing({ target: [providerCapabilitiesTable.providerId, providerCapabilitiesTable.capabilityType] });
    }
  }
}
