---
name: Risk Personality Profiles
description: Per-user risk ceilings (5 profiles), DB schema, riskProfile lib, routes, QDE hard-ceiling gate.
---

# Risk Personality Profiles

## Presets (lib/db/src/schema/risk-profiles.ts — RISK_PRESETS)
All percentage values are 0–100; maxSimultaneousTrades is a plain integer.

| Profile          | maxRiskPerTrade | maxPortfolioRisk | maxSimultaneous | maxDrawdown |
|------------------|-----------------|------------------|-----------------|-------------|
| preservation     | 0.5%            | 2%               | 2               | 5%          |
| balanced         | 1%              | 5%               | 5               | 10%         |
| aggressive_growth| 2%              | 10%              | 8               | 20%         |
| hyper_growth     | 5%              | 20%              | 15              | 40%         |
| custom           | (user-defined)  | (user-defined)   | (user-defined)  | (user-defined)|

## Schema (lib/db/src/schema/risk-profiles.ts)
Table `risk_profiles` keyed on `userId` (text PK). Four nullable override columns (real/integer).
- null override + non-custom profileType → use preset
- null override + custom profileType → unconstrained for that dimension
- Default when no row: balanced with all nulls

## Lib (artifacts/api-server/src/lib/riskProfile.ts)
- `getRiskProfile(userId)` — DB fetch or synthetic default
- `resolveEffectiveLimits(profile)` — pure resolver, override → preset → null
- `effectiveRiskLimit(userId)` — DB-backed version of resolveEffectiveLimits
- `validateRisk(userId, proposal)` — checks riskPerTrade, portfolioRisk, openPositions, drawdown; returns { allowed, violations[], effectiveLimits }
- `validateRiskFromTelemetry(userId, { openPositions, drawdown, balance, equity })` — derives portfolioRisk from balance/equity before calling validateRisk
- `saveRiskProfile(userId, patch)` — upsert helper; patch keys are optional

## Routes (artifacts/api-server/src/routes/risk-profiles.ts)
Mounted at `/api/risk-profile`:
- `GET /presets` — no auth; returns RISK_PRESETS map
- `GET /` — session auth; returns { profile, effectiveLimits }
- `PUT /` — session auth; accepts profileType + override fields + keepOverrides flag; audits with trading.risk_profile_updated
- `GET /effective-limits` — session auth; limits only (no raw profile)
- `POST /validate` — session auth; body: { riskPerTrade?, portfolioRisk?, openPositions?, drawdown? }

## QDE ceiling gate (artifacts/api-server/src/routes/qde.ts)
After decideAction returns ADD, calls validateRiskFromTelemetry. If any ceiling violated, overrides the decision to HOLD with a reason string. Fail-open on DB errors (logs warn, does not block trading).

**Why fail-open on DB error:** A ceiling-check blip should not silently halt QDE for the user. Errors are logged; the risk is bounded by the fact that the EA still enforces per-trade risk at order submission.

## Audit
`trading.risk_profile_updated` — emitted on every PUT; records previousProfileType, newProfileType, and the four override values.

## Key decisions
- Override fields replace preset values (not cap them) — user can both tighten and relax presets. Rationale: users are adults; the QDE is the enforcer, not the schema.
- keepOverrides flag on profile-type switch — defaults false (clean start with new preset), pass true to carry overrides across.
- Per-trade risk NOT enforced at QDE layer (lot size unknown at telemetry time); enforced by EA via POST /risk-profile/validate before order submission.
- drawdown is telemetry-provided (nullable in telemetry) — coerce undefined to null before passing to validateRiskFromTelemetry.
