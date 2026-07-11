import { pgTable, text, serial, timestamp, integer, real, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { eaRegistrationsTable } from "./ea-registrations";

/**
 * Rounding policies for volume normalisation.
 * Default: ROUND_DOWN — the safest option since it never opens a larger
 * position than the user intended and never exceeds broker maximum volume.
 */
export const ROUNDING_POLICIES = ["ROUND_DOWN", "ROUND_UP", "ROUND_NEAREST"] as const;
export type RoundingPolicyEnum = (typeof ROUNDING_POLICIES)[number];

/**
 * Broker-reported volume (lot) constraints for a specific symbol, captured by
 * the EA at initialisation time via SymbolInfoDouble(SYMBOL_VOLUME_MIN/MAX/STEP)
 * and stored per EA-registration so normalisation/validation can be applied
 * server-side and embedded back into the next EA build.
 *
 * One row per (eaRegistrationId, canonicalSymbol) — upserted by the EA on every
 * OnInit so the stored values always reflect the broker's current constraints.
 */
export const brokerVolumeConstraintsTable = pgTable(
  "broker_volume_constraints",
  {
    id: serial("id").primaryKey(),
    eaRegistrationId: integer("ea_registration_id")
      .notNull()
      .references(() => eaRegistrationsTable.id),
    /** Canonical symbol (normalised before storage, never a raw broker alias). */
    canonicalSymbol: text("canonical_symbol").notNull(),
    /** SYMBOL_VOLUME_MIN — minimum lot size the broker accepts for this symbol. */
    volumeMin: real("volume_min").notNull(),
    /** SYMBOL_VOLUME_MAX — maximum lot size the broker accepts for this symbol. */
    volumeMax: real("volume_max").notNull(),
    /**
     * SYMBOL_VOLUME_STEP — the granularity increment.  Volumes must be an
     * exact multiple of this value.  Typical values: 0.01, 0.1, 1.
     */
    volumeStep: real("volume_step").notNull(),
    /**
     * How the EA (and server-side normaliser) rounds a raw volume to the
     * nearest valid step multiple.  Stored here so it travels with the
     * constraint record and can be overridden per-symbol if needed.
     * Default: ROUND_DOWN.
     */
    roundingPolicy: text("rounding_policy", { enum: ROUNDING_POLICIES })
      .notNull()
      .default("ROUND_DOWN"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("broker_volume_constraints_ea_symbol_idx").on(
      table.eaRegistrationId,
      table.canonicalSymbol,
    ),
  ],
);

export const insertBrokerVolumeConstraintSchema = createInsertSchema(
  brokerVolumeConstraintsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBrokerVolumeConstraint = z.infer<typeof insertBrokerVolumeConstraintSchema>;
export type BrokerVolumeConstraint = typeof brokerVolumeConstraintsTable.$inferSelect;
