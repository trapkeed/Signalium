---
name: Capital Buckets
description: Per-bucket capital allocation (core/growth/speculative), risk profiles, leverage limits, symbol restrictions, QDE bucket-relative gate.
---

# Capital Buckets

## Schema (lib/db/src/schema/capital-buckets.ts)
Table `capital_buckets`:
- PK: `id` serial. Unique on `(userId, bucketType)`.
- `bucketType` enum: `core | growth | speculative`
- `allocationPct` real NOT NULL — % of total account balance
- `allocationAbs` real nullable — absolute $ override (takes priority over allocationPct when set)
- `riskProfileType` — same enum as risk_profiles, default `balanced`
- Same 4 nullable risk override columns as riskProfilesTable (maxRiskPerTrade, maxPortfolioRisk, maxSimultaneousTrades, maxDrawdownTolerance)
- `maxLeverage` real nullable
- `allowedSymbols` text[] nullable — whitelist (empty = unrestricted)
- `blockedSymbols` text[] nullable — blacklist
- `isActive` boolean

## Schema change: positionTelemetryTable (lib/db/src/schema/qde.ts)
Added nullable `bucketType text("bucket_type")` column. When the EA sends per-bucket telemetry it tags the frame with the bucketType; this is stored alongside the row for auditability and available-capital queries.

## Lib (artifacts/api-server/src/lib/capitalBuckets.ts)
- `allocateBucket(userId, bucketType, params)` — upsert; validates sum of allocationPct ≤ 100% across all active buckets; returns { bucket, totalAllocatedPct, remainingPct, warning? }
- `bucketRiskLimit(userId, bucketType, accountBalance)` — resolves effective limits using `resolveBucketLimits()` adapter + returns absolute-$ equivalents (maxRiskPerTrade_abs, maxPortfolioRisk_abs)
- `availableCapital(userId, accountBalance)` — per-bucket allocated/inUse/available; estimates in-use from latest telemetry row tagged with each bucketType (`max(0, -floatingPnl)`)
- `validateRiskForBucket(userId, bucketType, { openPositions, floatingPnl, drawdown, balance })` — QDE gate helper; computes bucket-relative portfolioRisk from floatingPnl / bucketBalance; calls `validateRiskAgainstLimits`
- `isBucketSymbolAllowed(bucket, symbol)` — pure allow/block list check
- `resolveAllocatedCapital(bucket, accountBalance)` — exported helper: allocationAbs ?? (allocationPct/100) × accountBalance

## riskProfile.ts refactor
Extracted `validateRiskAgainstLimits(limits, proposal)` as a new exported pure function. `validateRisk` now calls it (no logic duplication). `capitalBuckets.ts` imports it directly to apply the same violations logic against bucket limits.

## Routes (artifacts/api-server/src/routes/capital-buckets.ts)
Mounted at `/api/capital-buckets`:
- `GET /` — list active buckets
- `POST /` — upsert (requires bucketType + allocationPct)
- `GET /available?accountBalance=` — available capital per bucket
- `GET /:bucketType` — single bucket
- `PUT /:bucketType` — partial update; re-validates allocation total when allocationPct changes
- `DELETE /:bucketType` — sets isActive=false
- `GET /:bucketType/risk-limit?accountBalance=` — resolved limits + absolute-$ amounts
- `GET /:bucketType/symbol-check?symbol=` — allow/block list check

Account balance for GET routes: read from `?accountBalance` query param; falls back to latest telemetry row for the user.

## QDE ceiling gate (artifacts/api-server/src/routes/qde.ts)
`POST /qde/telemetry` now parses optional `bucketType` from the request body. If present and valid:
- Stored on the telemetry row (`bucketType` column)
- ADD ceiling gate calls `validateRiskForBucket` instead of `validateRiskFromTelemetry`
- Risk is assessed relative to bucket allocation (floatingPnl / bucketBalance) not total account
- HOLD override message includes the bucket context: "Risk ceiling reached (speculative bucket)"

When `bucketType` is absent: existing whole-account risk profile gate applies unchanged.

## Key decisions
**Why allocationAbs optional override:** Fixed-lot strategies need stable absolute limits that don't drift as account equity grows.
**Why estimating in-use from floatingPnl:** Per-bucket position tracking requires EA cooperation. The floatingPnl in a bucket-tagged telemetry frame already reflects only that bucket's positions (EA responsibility). inUseCapital = max(0, -floatingPnl).
**Why validateRiskAgainstLimits extracted:** Avoids duplicating the violations loop between account-level (validateRisk) and bucket-level (validateRiskForBucket). Single source of truth for the comparison logic.
**Why resolveBucketLimits uses a RiskProfile adapter:** CapitalBucket has the same 4 nullable override columns as riskProfilesTable. Projecting into a RiskProfile shape lets us reuse resolveEffectiveLimits without any duplication.
