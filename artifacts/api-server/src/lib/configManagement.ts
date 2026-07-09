/**
 * S26 — Configuration export/restore.
 *
 * Environment recreation and disaster recovery both need a way to rebuild
 * platform *configuration* (feature flags, subscription plans, symbol
 * registry, broker/data-provider definitions) on a fresh environment without
 * re-clicking through every admin screen by hand. This is deliberately
 * scoped to configuration, not user data — restoring user data belongs to
 * the database backup/restore flow (backupService.ts), not this JSON
 * export, which is small enough to read, diff, and hand-edit if needed.
 */
import { db, featureFlagsTable, plansTable, symbolCategoriesTable, symbolsTable, brokersTable, dataProvidersTable } from "@workspace/db";

export interface ConfigSnapshot {
  exportedAt: string;
  tables: {
    featureFlags: unknown[];
    symbolCategories: unknown[];
  };
  /**
   * Reference-only tables: included so an operator can see/diff what exists
   * on the source environment, but deliberately NOT round-tripped by
   * `importConfig` — see the note there for why (cross-environment FK
   * remapping). Rebuild these via their respective admin screens, using
   * this as a reference.
   */
  referenceOnly: {
    plans: unknown[];
    symbols: unknown[];
    brokers: unknown[];
    dataProviders: unknown[];
  };
}

export async function exportConfig(): Promise<ConfigSnapshot> {
  const [featureFlags, plans, symbolCategories, symbols, brokers, dataProviders] = await Promise.all([
    db.select().from(featureFlagsTable),
    db.select().from(plansTable),
    db.select().from(symbolCategoriesTable),
    db.select().from(symbolsTable),
    db.select().from(brokersTable),
    db.select().from(dataProvidersTable),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    tables: { featureFlags, symbolCategories },
    referenceOnly: { plans, symbols, brokers, dataProviders },
  };
}

/**
 * Imports a config snapshot idempotently — upserts by each table's natural
 * unique key (key/slug/canonicalSymbol/name) so re-importing the same
 * snapshot twice, or importing into an environment that already has some
 * overlapping rows, doesn't create duplicates or throw.
 */
export async function importConfig(snapshot: unknown, _actorUserId: string): Promise<{ tables: string[] }> {
  if (!snapshot || typeof snapshot !== "object" || !("tables" in snapshot)) {
    throw new Error("Malformed config snapshot — expected { exportedAt, tables }");
  }
  const { tables } = snapshot as ConfigSnapshot;
  const imported: string[] = [];

  await db.transaction(async (tx) => {
    if (Array.isArray(tables.featureFlags) && tables.featureFlags.length > 0) {
      for (const row of tables.featureFlags as Record<string, unknown>[]) {
        const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
        await tx.insert(featureFlagsTable).values(rest as typeof featureFlagsTable.$inferInsert)
          .onConflictDoUpdate({ target: featureFlagsTable.key, set: rest as typeof featureFlagsTable.$inferInsert });
      }
      imported.push("featureFlags");
    }

    if (Array.isArray(tables.symbolCategories) && tables.symbolCategories.length > 0) {
      for (const row of tables.symbolCategories as Record<string, unknown>[]) {
        const { id: _id, createdAt: _c, ...rest } = row;
        await tx.insert(symbolCategoriesTable).values(rest as typeof symbolCategoriesTable.$inferInsert)
          .onConflictDoUpdate({ target: symbolCategoriesTable.slug, set: rest as typeof symbolCategoriesTable.$inferInsert });
      }
      imported.push("symbolCategories");
    }
  });

  // plans/symbols/brokers/dataProviders are exported under `referenceOnly`
  // (not `tables`) precisely because they carry numeric FKs (categoryId,
  // etc) that won't line up across environments after a fresh import —
  // there is nothing to import here for them by design. Rebuild those via
  // their respective admin screens using the export as a reference.
  return { tables: imported };
}
