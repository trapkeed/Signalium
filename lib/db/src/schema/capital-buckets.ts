import {
  pgTable,
  text,
  serial,
  timestamp,
  real,
  integer,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { RISK_PROFILE_TYPES } from "./risk-profiles";

/**
 * The three capital bucket types.  Each user may have at most one active bucket
 * per type (enforced by the unique index on userId + bucketType).
 *
 * Intended semantics:
 *   core        — capital that must be preserved; conservative profile.
 *   growth      — medium-risk capital for compounding over the medium term.
 *   speculative — high-risk / high-reward allocation; 100% loss is tolerable.
 */
export const BUCKET_TYPES = ["core", "growth", "speculative"] as const;
export type BucketType = (typeof BUCKET_TYPES)[number];

/**
 * Capital bucket — represents a named slice of the user's account balance,
 * each with its own allocation, risk profile, leverage ceiling, and symbol
 * restrictions.
 *
 * Risk calculations performed against this bucket use `allocatedCapital` as
 * the denominator rather than the total account balance.  This allows, e.g.,
 * 100% risk on the speculative bucket while the core bucket is untouched.
 *
 * Allocation precedence: allocationAbs (absolute $) > allocationPct (% of
 * total account balance).  When allocationAbs is null, the server derives the
 * absolute amount from allocationPct × latestAccountBalance at query time.
 */
export const capitalBucketsTable = pgTable(
  "capital_buckets",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** One of the three named bucket types. Unique per user (enforced below). */
    bucketType: text("bucket_type", { enum: BUCKET_TYPES }).notNull(),
    /** Optional user-defined label. Defaults to the bucket type when null. */
    name: text("name"),
    /**
     * Percentage of total account balance allocated to this bucket (0–100).
     * Used as the fallback when allocationAbs is null.
     */
    allocationPct: real("allocation_pct").notNull(),
    /**
     * Absolute dollar amount override.  When set, allocationPct is still stored
     * for reference but the absolute value is used for risk calculations.
     * Useful for fixed-lot strategies where the allocation should not drift with
     * account equity.
     */
    allocationAbs: real("allocation_abs"),
    /** Risk profile governing this bucket's QDE ceilings. */
    riskProfileType: text("risk_profile_type", { enum: RISK_PROFILE_TYPES })
      .notNull()
      .default("balanced"),
    /**
     * Per-bucket risk overrides (same pattern as user-level riskProfilesTable).
     * null → use the preset for the selected riskProfileType.
     */
    maxRiskPerTrade: real("max_risk_per_trade"),
    maxPortfolioRisk: real("max_portfolio_risk"),
    maxSimultaneousTrades: integer("max_simultaneous_trades"),
    maxDrawdownTolerance: real("max_drawdown_tolerance"),
    /**
     * Maximum leverage the QDE may apply to positions within this bucket.
     * null = no bucket-level override (platform/broker defaults apply).
     */
    maxLeverage: real("max_leverage"),
    /**
     * Symbol allow-list.  When non-empty, the QDE may only trade these symbols
     * from this bucket.  Stored as normalised canonical symbols (e.g. "XAUUSD").
     */
    allowedSymbols: text("allowed_symbols").array(),
    /**
     * Symbol block-list.  Symbols the QDE must never trade from this bucket,
     * regardless of what the allow-list or global mappings say.
     */
    blockedSymbols: text("blocked_symbols").array(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("capital_buckets_user_type_idx").on(table.userId, table.bucketType),
    index("capital_buckets_user_idx").on(table.userId),
  ],
);

export const insertCapitalBucketSchema = createInsertSchema(capitalBucketsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCapitalBucket = z.infer<typeof insertCapitalBucketSchema>;
export type CapitalBucket = typeof capitalBucketsTable.$inferSelect;
