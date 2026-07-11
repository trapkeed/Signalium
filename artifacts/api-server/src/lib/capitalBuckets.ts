/**
 * Capital Buckets
 *
 * Three public functions consumed by the routes layer and the QDE ceiling gate:
 *
 *   allocateBucket(userId, bucketType, params)
 *     Create or update a bucket.  Validates total allocation ≤ 100%.
 *
 *   bucketRiskLimit(userId, bucketType, accountBalance)
 *     Resolves the bucket's effective risk ceilings relative to its allocated
 *     capital, also returning absolute-$ equivalents for the front end.
 *
 *   availableCapital(userId, accountBalance)
 *     Returns allocated and in-use capital for every active bucket.
 *     In-use is estimated from the most-recent per-bucket telemetry frame.
 *
 * QDE integration (called from qde.ts):
 *
 *   validateRiskForBucket(userId, bucketType, telemetry)
 *     Runs the ADD ceiling check relative to bucket size instead of the
 *     whole account.  Uses resolveEffectiveLimits (from riskProfile lib) on
 *     the bucket's own risk profile — no duplication of that logic.
 */

import {
  db,
  capitalBucketsTable,
  positionTelemetryTable,
  type CapitalBucket,
  type BucketType,
  BUCKET_TYPES,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  resolveEffectiveLimits,
  validateRiskAgainstLimits,
  type EffectiveRiskLimits,
  type ValidateRiskResult,
} from "./riskProfile";
import type { RiskProfileType } from "@workspace/db";
import { RISK_PROFILE_TYPES } from "@workspace/db";

export type { BucketType };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BucketAllocation {
  bucket: CapitalBucket;
  /** Absolute dollar amount allocated to this bucket (resolved from pct or abs). */
  allocatedCapital: number;
  /** Capital currently deployed (estimated from latest per-bucket telemetry). */
  inUseCapital: number;
  /** allocatedCapital − inUseCapital */
  availableCapital: number;
}

export interface BucketRiskLimitResult {
  bucket: CapitalBucket;
  allocatedCapital: number;
  limits: EffectiveRiskLimits;
  /** Absolute-$ equivalents — null when the underlying % limit is null. */
  absoluteLimits: {
    maxRiskPerTrade_abs: number | null;
    maxPortfolioRisk_abs: number | null;
  };
}

export interface AllocateBucketParams {
  name?: string | null;
  allocationPct: number;
  allocationAbs?: number | null;
  riskProfileType?: RiskProfileType;
  maxRiskPerTrade?: number | null;
  maxPortfolioRisk?: number | null;
  maxSimultaneousTrades?: number | null;
  maxDrawdownTolerance?: number | null;
  maxLeverage?: number | null;
  allowedSymbols?: string[] | null;
  blockedSymbols?: string[] | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolve a bucket's allocated capital as an absolute dollar amount.
 * Prefers allocationAbs when set; falls back to allocationPct × accountBalance.
 */
export function resolveAllocatedCapital(
  bucket: Pick<CapitalBucket, "allocationPct" | "allocationAbs">,
  accountBalance: number,
): number {
  if (bucket.allocationAbs !== null && bucket.allocationAbs !== undefined) {
    return bucket.allocationAbs;
  }
  return (bucket.allocationPct / 100) * accountBalance;
}

/**
 * Build an EffectiveRiskLimits from a bucket by projecting its shape onto the
 * RiskProfile shape that resolveEffectiveLimits already understands.
 * No logic duplication — this is purely an adapter.
 */
function resolveBucketLimits(bucket: CapitalBucket): EffectiveRiskLimits {
  return resolveEffectiveLimits({
    userId: bucket.userId,
    profileType: bucket.riskProfileType as RiskProfileType,
    maxRiskPerTrade: bucket.maxRiskPerTrade ?? null,
    maxPortfolioRisk: bucket.maxPortfolioRisk ?? null,
    maxSimultaneousTrades: bucket.maxSimultaneousTrades ?? null,
    maxDrawdownTolerance: bucket.maxDrawdownTolerance ?? null,
    updatedAt: bucket.updatedAt,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create or update a capital bucket.
 *
 * Validates that the sum of allocationPct across all active buckets for this
 * user does not exceed 100% after the upsert.  A warning is included in the
 * response when the total is between 95% and 100% (near-full allocation).
 */
export async function allocateBucket(
  userId: string,
  bucketType: BucketType,
  params: AllocateBucketParams,
): Promise<{
  bucket: CapitalBucket;
  totalAllocatedPct: number;
  remainingPct: number;
  warning?: string;
}> {
  // Fetch peer buckets (excluding this one) to validate total allocation.
  const peers = await db
    .select({ bucketType: capitalBucketsTable.bucketType, allocationPct: capitalBucketsTable.allocationPct })
    .from(capitalBucketsTable)
    .where(
      and(
        eq(capitalBucketsTable.userId, userId),
        eq(capitalBucketsTable.isActive, true),
      ),
    );

  const peerTotal = peers
    .filter((p) => p.bucketType !== bucketType)
    .reduce((sum, p) => sum + (p.allocationPct ?? 0), 0);

  const newTotal = peerTotal + params.allocationPct;
  if (newTotal > 100) {
    const available = 100 - peerTotal;
    throw new Error(
      `Allocation of ${params.allocationPct}% would bring total to ${newTotal.toFixed(1)}% (other buckets already use ${peerTotal.toFixed(1)}%). Maximum available: ${available.toFixed(1)}%.`,
    );
  }

  const [row] = await db
    .insert(capitalBucketsTable)
    .values({
      userId,
      bucketType,
      name: params.name ?? null,
      allocationPct: params.allocationPct,
      allocationAbs: params.allocationAbs ?? null,
      riskProfileType:
        (RISK_PROFILE_TYPES as readonly string[]).includes(params.riskProfileType ?? "")
          ? (params.riskProfileType as RiskProfileType)
          : "balanced",
      maxRiskPerTrade: params.maxRiskPerTrade ?? null,
      maxPortfolioRisk: params.maxPortfolioRisk ?? null,
      maxSimultaneousTrades: params.maxSimultaneousTrades ?? null,
      maxDrawdownTolerance: params.maxDrawdownTolerance ?? null,
      maxLeverage: params.maxLeverage ?? null,
      allowedSymbols: params.allowedSymbols ?? null,
      blockedSymbols: params.blockedSymbols ?? null,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [capitalBucketsTable.userId, capitalBucketsTable.bucketType],
      set: {
        name: params.name ?? null,
        allocationPct: params.allocationPct,
        allocationAbs: params.allocationAbs ?? null,
        riskProfileType:
          (RISK_PROFILE_TYPES as readonly string[]).includes(params.riskProfileType ?? "")
            ? (params.riskProfileType as RiskProfileType)
            : "balanced",
        maxRiskPerTrade: params.maxRiskPerTrade ?? null,
        maxPortfolioRisk: params.maxPortfolioRisk ?? null,
        maxSimultaneousTrades: params.maxSimultaneousTrades ?? null,
        maxDrawdownTolerance: params.maxDrawdownTolerance ?? null,
        maxLeverage: params.maxLeverage ?? null,
        allowedSymbols: params.allowedSymbols ?? null,
        blockedSymbols: params.blockedSymbols ?? null,
        isActive: true,
        updatedAt: new Date(),
      },
    })
    .returning();

  const remainingPct = 100 - newTotal;
  return {
    bucket: row,
    totalAllocatedPct: newTotal,
    remainingPct,
    warning:
      newTotal > 95 && newTotal <= 100
        ? `${newTotal.toFixed(1)}% of account balance is now allocated across buckets.`
        : undefined,
  };
}

/**
 * Resolve the risk ceilings for a bucket, expressed both as percentages and
 * as absolute-$ amounts derived from the bucket's allocated capital.
 *
 * Absolute-$ limits let the QDE and the front end enforce hard-dollar stops
 * ("do not lose more than $50 from this bucket") without needing to know the
 * full account balance at every call site.
 */
export async function bucketRiskLimit(
  userId: string,
  bucketType: BucketType,
  accountBalance: number,
): Promise<BucketRiskLimitResult> {
  const [bucket] = await db
    .select()
    .from(capitalBucketsTable)
    .where(
      and(
        eq(capitalBucketsTable.userId, userId),
        eq(capitalBucketsTable.bucketType, bucketType),
        eq(capitalBucketsTable.isActive, true),
      ),
    )
    .limit(1);

  if (!bucket) {
    throw new Error(`No active ${bucketType} bucket found for user.`);
  }

  const allocatedCapital = resolveAllocatedCapital(bucket, accountBalance);
  const limits = resolveBucketLimits(bucket);

  return {
    bucket,
    allocatedCapital,
    limits,
    absoluteLimits: {
      maxRiskPerTrade_abs:
        limits.maxRiskPerTrade !== null
          ? (limits.maxRiskPerTrade / 100) * allocatedCapital
          : null,
      maxPortfolioRisk_abs:
        limits.maxPortfolioRisk !== null
          ? (limits.maxPortfolioRisk / 100) * allocatedCapital
          : null,
    },
  };
}

/**
 * Return allocated and available capital for every active bucket.
 *
 * In-use capital is estimated from the most-recent telemetry frame tagged with
 * each bucketType.  When the EA sends per-bucket telemetry (floatingPnl
 * reflecting only that bucket's positions), the estimate is precise.  When
 * there is no tagged telemetry the in-use figure defaults to 0.
 */
export async function availableCapital(
  userId: string,
  accountBalance: number,
): Promise<BucketAllocation[]> {
  const buckets = await db
    .select()
    .from(capitalBucketsTable)
    .where(and(eq(capitalBucketsTable.userId, userId), eq(capitalBucketsTable.isActive, true)));

  if (buckets.length === 0) return [];

  // For each bucket, find the latest telemetry row tagged with that bucketType.
  const results = await Promise.all(
    buckets.map(async (bucket) => {
      const [latestTelemetry] = await db
        .select({
          floatingPnl: positionTelemetryTable.floatingPnl,
        })
        .from(positionTelemetryTable)
        .where(
          and(
            eq(positionTelemetryTable.userId, userId),
            eq(positionTelemetryTable.bucketType, bucket.bucketType),
          ),
        )
        .orderBy(desc(positionTelemetryTable.receivedAt))
        .limit(1);

      const allocatedCapital = resolveAllocatedCapital(bucket, accountBalance);
      // In-use = unrealised loss: how much of the bucket's capital is currently
      // at risk.  Positive floatingPnl (profit) does not reduce available capital.
      const inUseCapital = latestTelemetry
        ? Math.max(0, -latestTelemetry.floatingPnl)
        : 0;

      return {
        bucket,
        allocatedCapital,
        inUseCapital,
        availableCapital: Math.max(0, allocatedCapital - inUseCapital),
      };
    }),
  );

  return results;
}

/**
 * Symbol-restriction check: verify that a symbol is permitted by the bucket's
 * allow/block lists.
 */
export function isBucketSymbolAllowed(
  bucket: Pick<CapitalBucket, "allowedSymbols" | "blockedSymbols">,
  symbol: string,
): { allowed: boolean; reason?: string } {
  const sym = symbol.toUpperCase();

  if (bucket.blockedSymbols && bucket.blockedSymbols.length > 0) {
    if (bucket.blockedSymbols.map((s) => s.toUpperCase()).includes(sym)) {
      return { allowed: false, reason: `Symbol ${sym} is on this bucket's block list.` };
    }
  }
  if (bucket.allowedSymbols && bucket.allowedSymbols.length > 0) {
    if (!bucket.allowedSymbols.map((s) => s.toUpperCase()).includes(sym)) {
      return { allowed: false, reason: `Symbol ${sym} is not on this bucket's allow list.` };
    }
  }
  return { allowed: true };
}

/**
 * QDE ceiling gate: validate an ADD action relative to the bucket's allocated
 * capital and risk profile, rather than the full account.
 *
 * Assumes the telemetry frame was tagged with this bucketType and that
 * floatingPnl reflects ONLY this bucket's open positions (the EA is responsible
 * for sending per-bucket telemetry frames).
 *
 * @param openPositions  Open positions currently attributed to this bucket.
 * @param floatingPnl    Bucket-specific unrealised PnL (negative = loss).
 * @param drawdown       Bucket-level drawdown %, if reported by the EA.
 * @param balance        Total account balance (used to derive absolute bucket allocation).
 */
export async function validateRiskForBucket(
  userId: string,
  bucketType: BucketType,
  opts: {
    openPositions: number;
    floatingPnl: number;
    drawdown: number | null;
    balance: number;
  },
): Promise<ValidateRiskResult> {
  const [bucket] = await db
    .select()
    .from(capitalBucketsTable)
    .where(
      and(
        eq(capitalBucketsTable.userId, userId),
        eq(capitalBucketsTable.bucketType, bucketType),
        eq(capitalBucketsTable.isActive, true),
      ),
    )
    .limit(1);

  if (!bucket) {
    // No bucket configured → fall back: allowed (no ceiling to enforce).
    return {
      allowed: true,
      violations: [],
      effectiveLimits: {
        profileType: "custom",
        maxRiskPerTrade: null,
        maxPortfolioRisk: null,
        maxSimultaneousTrades: null,
        maxDrawdownTolerance: null,
      },
    };
  }

  const allocatedCapital = resolveAllocatedCapital(bucket, opts.balance);
  const limits = resolveBucketLimits(bucket);

  // Express unrealised loss as a % of THIS bucket's allocated capital.
  const bucketPortfolioRisk =
    allocatedCapital > 0 ? Math.max(0, (-opts.floatingPnl / allocatedCapital) * 100) : 0;

  return validateRiskAgainstLimits(limits, {
    portfolioRisk: bucketPortfolioRisk,
    openPositions: opts.openPositions,
    drawdown: opts.drawdown ?? undefined,
  });
}
