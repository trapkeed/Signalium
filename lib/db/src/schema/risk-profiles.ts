import { pgTable, text, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const RISK_PROFILE_TYPES = [
  "preservation",
  "balanced",
  "aggressive_growth",
  "hyper_growth",
  "custom",
] as const;
export type RiskProfileType = (typeof RISK_PROFILE_TYPES)[number];

/**
 * Platform-defined preset ceilings for each named profile.
 * All values are percentages (0–100) except maxSimultaneousTrades.
 *
 * The QDE treats these as hard ceilings — it will not issue an ADD action
 * that would cause any of these limits to be breached.  Users can override
 * individual fields to TIGHTEN or RELAX them; the effective value is always
 * the stored override (if set) or the preset (if not).
 */
export const RISK_PRESETS: Record<
  Exclude<RiskProfileType, "custom">,
  {
    maxRiskPerTrade: number;
    maxPortfolioRisk: number;
    maxSimultaneousTrades: number;
    maxDrawdownTolerance: number;
  }
> = {
  preservation: {
    maxRiskPerTrade: 0.5,
    maxPortfolioRisk: 2,
    maxSimultaneousTrades: 2,
    maxDrawdownTolerance: 5,
  },
  balanced: {
    maxRiskPerTrade: 1,
    maxPortfolioRisk: 5,
    maxSimultaneousTrades: 5,
    maxDrawdownTolerance: 10,
  },
  aggressive_growth: {
    maxRiskPerTrade: 2,
    maxPortfolioRisk: 10,
    maxSimultaneousTrades: 8,
    maxDrawdownTolerance: 20,
  },
  hyper_growth: {
    maxRiskPerTrade: 5,
    maxPortfolioRisk: 20,
    maxSimultaneousTrades: 15,
    maxDrawdownTolerance: 40,
  },
};

/**
 * Per-user risk personality profile.  One row per user (userId is the PK).
 * Upserted whenever the user changes their profile type or overrides any field.
 *
 * Override columns are nullable — null means "use the preset default for the
 * selected profileType."  For the `custom` profile there is no preset, so
 * null means unconstrained (the QDE will not enforce a ceiling for that
 * dimension).
 *
 * Default profile when no row exists: `balanced` with all nulls (preset
 * values apply).
 */
export const riskProfilesTable = pgTable("risk_profiles", {
  userId: text("user_id").primaryKey(),
  /** Active risk personality. Determines preset defaults for null override fields. */
  profileType: text("profile_type", { enum: RISK_PROFILE_TYPES })
    .notNull()
    .default("balanced"),
  /**
   * Maximum risk per individual trade as % of account balance.
   * null → use preset for the current profileType (or unconstrained for custom).
   */
  maxRiskPerTrade: real("max_risk_per_trade"),
  /**
   * Maximum total open risk as % of account balance (sum of unrealised
   * exposure across all open positions).
   */
  maxPortfolioRisk: real("max_portfolio_risk"),
  /** Hard cap on the number of concurrently open positions the QDE will manage. */
  maxSimultaneousTrades: integer("max_simultaneous_trades"),
  /**
   * Maximum drawdown the user tolerates before the QDE stops issuing new
   * entry (ADD) actions, as a %.
   */
  maxDrawdownTolerance: real("max_drawdown_tolerance"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRiskProfileSchema = createInsertSchema(riskProfilesTable).omit({
  updatedAt: true,
});
export type InsertRiskProfile = z.infer<typeof insertRiskProfileSchema>;
export type RiskProfile = typeof riskProfilesTable.$inferSelect;
