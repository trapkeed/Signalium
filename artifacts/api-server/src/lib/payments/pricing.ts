import type { Plan } from "@workspace/db";

/**
 * Resolves the price (USD/month) a given plan should be sold at.
 * Resolution order: regional override (if a region is supplied and the plan
 * has a price configured for it) > promotional price (if set) > base price.
 * This is the single source of truth for "effective price" — both the
 * pricing page and payment-intent creation should call this rather than
 * re-implementing the fallback chain.
 */
export function resolvePlanPrice(plan: Pick<Plan, "priceMonthly" | "promoPriceMonthly" | "regionalPricing">, region?: string | null): number {
  if (region) {
    const regional = plan.regionalPricing as Record<string, number> | null | undefined;
    const regionalPrice = regional?.[region.toUpperCase()];
    if (typeof regionalPrice === "number") return regionalPrice;
  }
  if (typeof plan.promoPriceMonthly === "number") return plan.promoPriceMonthly;
  return plan.priceMonthly;
}
