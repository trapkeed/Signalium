/**
 * Risk Personality Profile helpers
 *
 * Three public exports used by routes and the QDE telemetry handler:
 *
 *   getRiskProfile(userId)      — raw DB row (or platform default)
 *   effectiveRiskLimit(userId)  — resolved ceilings (override → preset → null)
 *   validateRisk(userId, proposal) — check a proposal against the ceilings
 *
 * The QDE treats the effective limits as hard ceilings:
 *   - ADD is blocked when openPositions ≥ maxSimultaneousTrades
 *   - ADD is blocked when drawdown ≥ maxDrawdownTolerance
 *   - ADD is blocked when portfolioRisk ≥ maxPortfolioRisk
 *   - The per-trade risk limit is enforced by the EA itself and via the
 *     /risk-profile/validate endpoint before submitting an order.
 *
 * All percentage values are 0-100 (e.g. 1 = 1%, not 0.01).
 */

import {
  db,
  riskProfilesTable,
  RISK_PRESETS,
  RISK_PROFILE_TYPES,
  type RiskProfile,
  type RiskProfileType,
} from "@workspace/db";
import { eq } from "drizzle-orm";

export type { RiskProfileType };

/** Resolved ceiling for every dimension.  null means no ceiling (custom profile, field unset). */
export interface EffectiveRiskLimits {
  profileType: RiskProfileType;
  maxRiskPerTrade: number | null;
  maxPortfolioRisk: number | null;
  maxSimultaneousTrades: number | null;
  maxDrawdownTolerance: number | null;
}

export interface RiskViolation {
  field: "maxRiskPerTrade" | "maxPortfolioRisk" | "maxSimultaneousTrades" | "maxDrawdownTolerance";
  ceiling: number;
  actual: number;
  message: string;
}

export interface ValidateRiskResult {
  allowed: boolean;
  violations: RiskViolation[];
  effectiveLimits: EffectiveRiskLimits;
}

export interface RiskProposal {
  /** Proposed risk for the single new trade, as % of account balance. */
  riskPerTrade?: number;
  /** Current total open risk across all positions, as % of account balance. */
  portfolioRisk?: number;
  /** Number of positions that will be open after this trade (i.e. current + 1 for a new entry). */
  openPositions?: number;
  /** Current drawdown as %. */
  drawdown?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_PROFILE_TYPE: RiskProfileType = "balanced";

/** Returns a synthetic default row when the user has never saved a profile. */
function defaultProfile(userId: string): RiskProfile {
  return {
    userId,
    profileType: DEFAULT_PROFILE_TYPE,
    maxRiskPerTrade: null,
    maxPortfolioRisk: null,
    maxSimultaneousTrades: null,
    maxDrawdownTolerance: null,
    updatedAt: new Date(0),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch the user's raw risk profile row.  Returns the platform default (balanced,
 * all nulls) when the user has never explicitly saved a profile.
 */
export async function getRiskProfile(userId: string): Promise<RiskProfile> {
  const [row] = await db
    .select()
    .from(riskProfilesTable)
    .where(eq(riskProfilesTable.userId, userId))
    .limit(1);
  return row ?? defaultProfile(userId);
}

/**
 * Resolve every dimension to its effective ceiling.
 *
 * Resolution order per field:
 *   1. User override (stored in the DB column) — if non-null, use it.
 *   2. Preset for the profileType — if profileType is not "custom", use
 *      the platform-defined preset value.
 *   3. null — no ceiling for this dimension (only reachable via custom with
 *      no override set).
 */
export async function effectiveRiskLimit(userId: string): Promise<EffectiveRiskLimits> {
  const profile = await getRiskProfile(userId);
  return resolveEffectiveLimits(profile);
}

/** Pure resolver — split out so it can be called without an extra DB round-trip
 *  when the caller already holds the profile row. */
export function resolveEffectiveLimits(profile: RiskProfile): EffectiveRiskLimits {
  const preset =
    profile.profileType !== "custom"
      ? RISK_PRESETS[profile.profileType as Exclude<RiskProfileType, "custom">]
      : null;

  const resolve = <T extends number>(override: T | null, presetVal: T | undefined): T | null =>
    override !== null && override !== undefined
      ? override
      : presetVal !== undefined
      ? presetVal
      : null;

  return {
    profileType: profile.profileType,
    maxRiskPerTrade: resolve(profile.maxRiskPerTrade, preset?.maxRiskPerTrade),
    maxPortfolioRisk: resolve(profile.maxPortfolioRisk, preset?.maxPortfolioRisk),
    maxSimultaneousTrades:
      profile.maxSimultaneousTrades !== null && profile.maxSimultaneousTrades !== undefined
        ? profile.maxSimultaneousTrades
        : preset?.maxSimultaneousTrades ?? null,
    maxDrawdownTolerance: resolve(profile.maxDrawdownTolerance, preset?.maxDrawdownTolerance),
  };
}

/**
 * Pure violations check: given already-resolved limits and a proposal, return
 * the full ValidateRiskResult without any DB access.
 *
 * Extracted so capitalBuckets.ts can apply the same logic against bucket-level
 * limits without duplicating the violations loop.  Called by validateRisk and
 * validateRiskForBucket in capitalBuckets.ts.
 */
export function validateRiskAgainstLimits(
  limits: EffectiveRiskLimits,
  proposal: RiskProposal,
): ValidateRiskResult {
  const violations: RiskViolation[] = [];

  if (
    proposal.riskPerTrade !== undefined &&
    limits.maxRiskPerTrade !== null &&
    proposal.riskPerTrade > limits.maxRiskPerTrade
  ) {
    violations.push({
      field: "maxRiskPerTrade",
      ceiling: limits.maxRiskPerTrade,
      actual: proposal.riskPerTrade,
      message: `Per-trade risk ${proposal.riskPerTrade.toFixed(2)}% exceeds the ${limits.profileType} ceiling of ${limits.maxRiskPerTrade}%`,
    });
  }

  if (
    proposal.portfolioRisk !== undefined &&
    limits.maxPortfolioRisk !== null &&
    proposal.portfolioRisk >= limits.maxPortfolioRisk
  ) {
    violations.push({
      field: "maxPortfolioRisk",
      ceiling: limits.maxPortfolioRisk,
      actual: proposal.portfolioRisk,
      message: `Portfolio risk ${proposal.portfolioRisk.toFixed(2)}% would reach or exceed the ${limits.profileType} ceiling of ${limits.maxPortfolioRisk}%`,
    });
  }

  if (
    proposal.openPositions !== undefined &&
    limits.maxSimultaneousTrades !== null &&
    proposal.openPositions >= limits.maxSimultaneousTrades
  ) {
    violations.push({
      field: "maxSimultaneousTrades",
      ceiling: limits.maxSimultaneousTrades,
      actual: proposal.openPositions,
      message: `Open positions (${proposal.openPositions}) would reach or exceed the ${limits.profileType} limit of ${limits.maxSimultaneousTrades} simultaneous trades`,
    });
  }

  if (
    proposal.drawdown !== undefined &&
    limits.maxDrawdownTolerance !== null &&
    proposal.drawdown >= limits.maxDrawdownTolerance
  ) {
    violations.push({
      field: "maxDrawdownTolerance",
      ceiling: limits.maxDrawdownTolerance,
      actual: proposal.drawdown,
      message: `Current drawdown ${proposal.drawdown.toFixed(2)}% has reached the ${limits.profileType} tolerance of ${limits.maxDrawdownTolerance}%`,
    });
  }

  return { allowed: violations.length === 0, violations, effectiveLimits: limits };
}

/**
 * Validate a risk proposal against the user's effective ceilings (DB-backed).
 *
 * Only checks dimensions for which (a) a value is provided in the proposal
 * AND (b) a ceiling is defined in the effective limits.
 */
export async function validateRisk(
  userId: string,
  proposal: RiskProposal,
): Promise<ValidateRiskResult> {
  const profile = await getRiskProfile(userId);
  const limits = resolveEffectiveLimits(profile);
  return validateRiskAgainstLimits(limits, proposal);
}

/**
 * Validate risk from live telemetry as sent by the QDE handler.
 * Computes portfolioRisk from balance/equity when not explicitly provided.
 *
 * @param openPositions  Current open position count (before any new entry).
 * @param drawdown       Current drawdown % (if available from telemetry).
 * @param balance        Account balance.
 * @param equity         Account equity (balance + floating PnL).
 */
export async function validateRiskFromTelemetry(
  userId: string,
  opts: {
    openPositions: number;
    drawdown: number | null;
    balance: number;
    equity: number;
  },
): Promise<ValidateRiskResult> {
  // Derive portfolio risk: how much of the account is currently exposed as
  // unrealised loss.  Positive when equity < balance (i.e. currently at a loss).
  const portfolioRisk =
    opts.balance > 0 ? Math.max(0, ((opts.balance - opts.equity) / opts.balance) * 100) : 0;

  return validateRisk(userId, {
    openPositions: opts.openPositions,
    portfolioRisk,
    drawdown: opts.drawdown ?? undefined,
    // riskPerTrade is not known here — checked separately via the validate endpoint
  });
}

/**
 * Upsert a risk profile, returning the saved row.
 * Exported here so the route doesn't need to import drizzle directly.
 */
export async function saveRiskProfile(
  userId: string,
  patch: {
    profileType?: RiskProfileType;
    maxRiskPerTrade?: number | null;
    maxPortfolioRisk?: number | null;
    maxSimultaneousTrades?: number | null;
    maxDrawdownTolerance?: number | null;
  },
): Promise<RiskProfile> {
  const [row] = await db
    .insert(riskProfilesTable)
    .values({
      userId,
      profileType: patch.profileType ?? DEFAULT_PROFILE_TYPE,
      maxRiskPerTrade: patch.maxRiskPerTrade ?? null,
      maxPortfolioRisk: patch.maxPortfolioRisk ?? null,
      maxSimultaneousTrades: patch.maxSimultaneousTrades ?? null,
      maxDrawdownTolerance: patch.maxDrawdownTolerance ?? null,
    })
    .onConflictDoUpdate({
      target: [riskProfilesTable.userId],
      set: {
        ...(patch.profileType !== undefined ? { profileType: patch.profileType } : {}),
        ...(patch.maxRiskPerTrade !== undefined
          ? { maxRiskPerTrade: patch.maxRiskPerTrade }
          : {}),
        ...(patch.maxPortfolioRisk !== undefined
          ? { maxPortfolioRisk: patch.maxPortfolioRisk }
          : {}),
        ...(patch.maxSimultaneousTrades !== undefined
          ? { maxSimultaneousTrades: patch.maxSimultaneousTrades }
          : {}),
        ...(patch.maxDrawdownTolerance !== undefined
          ? { maxDrawdownTolerance: patch.maxDrawdownTolerance }
          : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}
