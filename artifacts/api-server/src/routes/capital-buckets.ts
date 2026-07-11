/**
 * Capital Buckets Routes
 *
 *   GET  /capital-buckets                          — list user's buckets
 *   POST /capital-buckets                          — create/update a bucket
 *   GET  /capital-buckets/available                — available capital (requires accountBalance)
 *   GET  /capital-buckets/:bucketType              — get one bucket
 *   PUT  /capital-buckets/:bucketType              — update one bucket
 *   DELETE /capital-buckets/:bucketType            — deactivate a bucket
 *   GET  /capital-buckets/:bucketType/risk-limit   — risk limits relative to account balance
 */
import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, capitalBucketsTable, positionTelemetryTable, BUCKET_TYPES, RISK_PROFILE_TYPES, type BucketType } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  allocateBucket,
  bucketRiskLimit,
  availableCapital,
  isBucketSymbolAllowed,
} from "../lib/capitalBuckets";
import { logAudit } from "../lib/auditLog";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseBucketType(raw: string): BucketType | null {
  return (BUCKET_TYPES as readonly string[]).includes(raw) ? (raw as BucketType) : null;
}

/** Latest account balance from the user's most recent telemetry frame. */
async function latestAccountBalance(userId: string): Promise<number | null> {
  const [row] = await db
    .select({ balance: positionTelemetryTable.balance })
    .from(positionTelemetryTable)
    .where(eq(positionTelemetryTable.userId, userId))
    .orderBy(desc(positionTelemetryTable.receivedAt))
    .limit(1);
  return row?.balance ?? null;
}

function parseAccountBalance(queryVal: unknown, fallback: number | null): number | null {
  if (queryVal !== undefined) {
    const n = Number(queryVal);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

// ─── List ─────────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const buckets = await db
      .select()
      .from(capitalBucketsTable)
      .where(and(eq(capitalBucketsTable.userId, userId), eq(capitalBucketsTable.isActive, true)));
    return res.json(buckets);
  } catch (err) {
    req.log.error(err, "Failed to list capital buckets");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Available capital ────────────────────────────────────────────────────────

router.get("/available", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const latest = await latestAccountBalance(userId);
    const accountBalance = parseAccountBalance(req.query.accountBalance, latest);
    if (!accountBalance) {
      return res.status(400).json({
        error:
          "accountBalance query parameter is required when no EA telemetry has been received yet.",
      });
    }

    const allocations = await availableCapital(userId, accountBalance);
    return res.json({ accountBalance, buckets: allocations });
  } catch (err) {
    req.log.error(err, "Failed to compute available capital");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Create / upsert ─────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body as Record<string, unknown>;
  const bucketType = parseBucketType(String(body.bucketType ?? ""));
  if (!bucketType) {
    return res.status(400).json({
      error: `bucketType must be one of: ${BUCKET_TYPES.join(", ")}`,
    });
  }

  const allocationPct = Number(body.allocationPct);
  if (!Number.isFinite(allocationPct) || allocationPct <= 0 || allocationPct > 100) {
    return res.status(400).json({ error: "allocationPct must be a number between 0 and 100" });
  }

  if (
    body.riskProfileType !== undefined &&
    !(RISK_PROFILE_TYPES as readonly string[]).includes(String(body.riskProfileType))
  ) {
    return res.status(400).json({
      error: `riskProfileType must be one of: ${RISK_PROFILE_TYPES.join(", ")}`,
    });
  }

  const pct = (v: unknown) =>
    v !== undefined && v !== null
      ? (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100 ? Number(v) : undefined)
      : null;
  const pos = (v: unknown) =>
    v !== undefined && v !== null
      ? (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : undefined)
      : null;

  const maxRiskPerTrade = pct(body.maxRiskPerTrade);
  const maxPortfolioRisk = pct(body.maxPortfolioRisk);
  const maxDrawdownTolerance = pct(body.maxDrawdownTolerance);
  const maxSimultaneousTrades = pos(body.maxSimultaneousTrades);

  if (maxRiskPerTrade === undefined || maxPortfolioRisk === undefined || maxDrawdownTolerance === undefined || maxSimultaneousTrades === undefined) {
    return res.status(400).json({ error: "maxRiskPerTrade, maxPortfolioRisk, maxDrawdownTolerance must be 0–100; maxSimultaneousTrades must be a positive integer (or null to clear)" });
  }

  const maxLeverage =
    body.maxLeverage !== undefined && body.maxLeverage !== null
      ? Number(body.maxLeverage) > 0 ? Number(body.maxLeverage) : undefined
      : null;
  if (maxLeverage === undefined) {
    return res.status(400).json({ error: "maxLeverage must be a positive number or null" });
  }

  try {
    const result = await allocateBucket(userId, bucketType, {
      name: typeof body.name === "string" ? body.name.trim() || null : null,
      allocationPct,
      allocationAbs: body.allocationAbs !== undefined && body.allocationAbs !== null
        ? Number(body.allocationAbs) > 0 ? Number(body.allocationAbs) : null
        : null,
      riskProfileType: body.riskProfileType as typeof RISK_PROFILE_TYPES[number] | undefined,
      maxRiskPerTrade,
      maxPortfolioRisk,
      maxSimultaneousTrades,
      maxDrawdownTolerance,
      maxLeverage,
      allowedSymbols: Array.isArray(body.allowedSymbols)
        ? (body.allowedSymbols as string[]).map((s) => s.toUpperCase())
        : null,
      blockedSymbols: Array.isArray(body.blockedSymbols)
        ? (body.blockedSymbols as string[]).map((s) => s.toUpperCase())
        : null,
    });

    await logAudit(userId, "trading.capital_bucket_updated", "user", userId, {
      bucketType,
      allocationPct,
      riskProfileType: result.bucket.riskProfileType,
    });

    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Maximum available")) {
      return res.status(409).json({ error: err.message });
    }
    req.log.error(err, "Failed to create capital bucket");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Single bucket ────────────────────────────────────────────────────────────

router.get("/:bucketType", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const bucketType = parseBucketType(req.params.bucketType);
  if (!bucketType) return res.status(404).json({ error: "Unknown bucket type" });

  try {
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

    if (!bucket) return res.status(404).json({ error: `No active ${bucketType} bucket found` });
    return res.json(bucket);
  } catch (err) {
    req.log.error(err, "Failed to get capital bucket");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:bucketType", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const bucketType = parseBucketType(req.params.bucketType);
  if (!bucketType) return res.status(404).json({ error: "Unknown bucket type" });

  const body = req.body as Record<string, unknown>;

  // Must have an existing active bucket to update.
  const [existing] = await db
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

  if (!existing) {
    return res.status(404).json({
      error: `No active ${bucketType} bucket. Use POST /capital-buckets to create one.`,
    });
  }

  // Build patch — only apply fields that were provided in the body.
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) patch.name = typeof body.name === "string" ? body.name.trim() || null : null;
  if (body.allocationPct !== undefined) {
    const n = Number(body.allocationPct);
    if (!Number.isFinite(n) || n <= 0 || n > 100)
      return res.status(400).json({ error: "allocationPct must be between 0 and 100" });
    patch.allocationPct = n;
  }
  if (body.allocationAbs !== undefined)
    patch.allocationAbs = body.allocationAbs !== null ? Number(body.allocationAbs) : null;
  if (body.riskProfileType !== undefined) {
    if (!(RISK_PROFILE_TYPES as readonly string[]).includes(String(body.riskProfileType)))
      return res.status(400).json({ error: `riskProfileType must be one of: ${RISK_PROFILE_TYPES.join(", ")}` });
    patch.riskProfileType = body.riskProfileType;
  }
  const overrideFields = ["maxRiskPerTrade", "maxPortfolioRisk", "maxDrawdownTolerance", "maxSimultaneousTrades", "maxLeverage"] as const;
  for (const f of overrideFields) {
    if (body[f] !== undefined)
      patch[f] = body[f] !== null ? Number(body[f]) : null;
  }
  if (body.allowedSymbols !== undefined)
    patch.allowedSymbols = Array.isArray(body.allowedSymbols) ? (body.allowedSymbols as string[]).map((s) => s.toUpperCase()) : null;
  if (body.blockedSymbols !== undefined)
    patch.blockedSymbols = Array.isArray(body.blockedSymbols) ? (body.blockedSymbols as string[]).map((s) => s.toUpperCase()) : null;

  // If allocationPct is changing, validate total allocation.
  if (patch.allocationPct !== undefined) {
    const peers = await db
      .select({ bucketType: capitalBucketsTable.bucketType, allocationPct: capitalBucketsTable.allocationPct })
      .from(capitalBucketsTable)
      .where(and(eq(capitalBucketsTable.userId, userId), eq(capitalBucketsTable.isActive, true)));
    const peerTotal = peers.filter((p) => p.bucketType !== bucketType).reduce((s, p) => s + p.allocationPct, 0);
    const newTotal = peerTotal + (patch.allocationPct as number);
    if (newTotal > 100)
      return res.status(409).json({ error: `Allocation would reach ${newTotal.toFixed(1)}%. Other buckets use ${peerTotal.toFixed(1)}%.` });
  }

  try {
    const [updated] = await db
      .update(capitalBucketsTable)
      .set(patch as Partial<typeof capitalBucketsTable.$inferInsert>)
      .where(and(eq(capitalBucketsTable.userId, userId), eq(capitalBucketsTable.bucketType, bucketType)))
      .returning();

    await logAudit(userId, "trading.capital_bucket_updated", "user", userId, { bucketType, patch });
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to update capital bucket");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:bucketType", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const bucketType = parseBucketType(req.params.bucketType);
  if (!bucketType) return res.status(404).json({ error: "Unknown bucket type" });

  try {
    const [updated] = await db
      .update(capitalBucketsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(capitalBucketsTable.userId, userId), eq(capitalBucketsTable.bucketType, bucketType)))
      .returning();

    if (!updated) return res.status(404).json({ error: `No ${bucketType} bucket found` });

    await logAudit(userId, "trading.capital_bucket_updated", "user", userId, {
      bucketType,
      action: "deactivated",
    });
    return res.json({ deactivated: true, bucket: updated });
  } catch (err) {
    req.log.error(err, "Failed to deactivate capital bucket");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Risk limit for a bucket ─────────────────────────────────────────────────

router.get("/:bucketType/risk-limit", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const bucketType = parseBucketType(req.params.bucketType);
  if (!bucketType) return res.status(404).json({ error: "Unknown bucket type" });

  try {
    const latest = await latestAccountBalance(userId);
    const accountBalance = parseAccountBalance(req.query.accountBalance, latest);
    if (!accountBalance) {
      return res.status(400).json({ error: "accountBalance query parameter required" });
    }

    const result = await bucketRiskLimit(userId, bucketType, accountBalance);
    return res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message.includes("No active")) {
      return res.status(404).json({ error: err.message });
    }
    req.log.error(err, "Failed to compute bucket risk limit");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Symbol restriction check ─────────────────────────────────────────────────

router.get("/:bucketType/symbol-check", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const bucketType = parseBucketType(req.params.bucketType);
  if (!bucketType) return res.status(404).json({ error: "Unknown bucket type" });

  const symbol = typeof req.query.symbol === "string" ? req.query.symbol.toUpperCase() : null;
  if (!symbol) return res.status(400).json({ error: "symbol query parameter required" });

  try {
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

    if (!bucket) return res.status(404).json({ error: `No active ${bucketType} bucket found` });
    return res.json({ symbol, bucketType, ...isBucketSymbolAllowed(bucket, symbol) });
  } catch (err) {
    req.log.error(err, "Failed to check symbol against bucket");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
