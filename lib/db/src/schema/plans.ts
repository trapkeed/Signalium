import { pgTable, text, serial, timestamp, boolean, real, integer, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Plans are the single source of truth for what a tier can do. Every
// capability flag/limit here is read by the EntitlementEngine
// (artifacts/api-server/src/lib/entitlementEngine.ts) at decision time —
// nothing else in the codebase should branch on `tier` name directly. `tier`
// is kept only for display/ordering purposes (marketing labels, sort order).
export const plansTable = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  priceMonthly: real("price_monthly").notNull().default(0),
  // Marketing bullet list shown on the pricing page — not used for access
  // decisions. See the capability fields below for actual gating.
  features: json("features").$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  tier: text("tier", { enum: ["starter", "professional", "enterprise"] }).notNull().default("starter"),
  // ─── Capability fields (read by EntitlementEngine) ───────────────────────
  // Max number of active EA terminal registrations allowed under this plan.
  // Null = unlimited.
  maxEas: integer("max_eas"),
  // Max number of distinct trading symbols the user may run EAs/telemetry on
  // at once. Null = unlimited.
  maxSymbols: integer("max_symbols"),
  // Whether the trainer is allowed to run in autonomous mode (deciding and
  // pushing actions to the EA) for subscribers on this plan.
  autonomousAllowed: boolean("autonomous_allowed").notNull().default(false),
  // Whether subscribers on this plan may issue/use API keys at all (gates
  // key issuance and the EA WebSocket/HTTP polling loop).
  apiAccessAllowed: boolean("api_access_allowed").notNull().default(true),
  // Whether subscribers on this plan can access research/analytics surfaces.
  researchAccess: boolean("research_access").notNull().default(true),
  // ─── Promotional / regional pricing ──────────────────────────────────────
  // Optional promotional price shown/used instead of priceMonthly while set.
  // Null = no promo running. Clearing it (setting back to null) restores the
  // base price — there is no separate "promo active" flag by design, the
  // presence of a value *is* the toggle.
  promoPriceMonthly: real("promo_price_monthly"),
  // Short label surfaced next to the promo price (e.g. "Black Friday", "Launch offer").
  promoLabel: text("promo_label"),
  // Region-code (e.g. "US", "IN", "EU") -> absolute monthly price override in
  // USD, applied instead of priceMonthly/promoPriceMonthly for a matching
  // region. Resolution order (see lib/payments/pricing.ts): regional > promo
  // > base. Null/empty = no regional pricing configured.
  regionalPricing: json("regional_pricing").$type<Record<string, number>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlanSchema = createInsertSchema(plansTable).omit({ id: true, createdAt: true });
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plansTable.$inferSelect;
