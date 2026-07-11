/**
 * Risk Profile Routes
 *
 *   GET  /risk-profile          — current profile + resolved effective limits
 *   PUT  /risk-profile          — update profile type and/or overrides
 *   POST /risk-profile/validate — validate a risk proposal against ceilings
 *   GET  /risk-profile/presets  — all named preset definitions (public, no auth)
 */
import { Router } from "express";
import { getAuth } from "../lib/auth";
import { RISK_PRESETS, RISK_PROFILE_TYPES, type RiskProfileType } from "@workspace/db";
import {
  getRiskProfile,
  effectiveRiskLimit,
  validateRisk,
  resolveEffectiveLimits,
  saveRiskProfile,
} from "../lib/riskProfile";
import { logAudit } from "../lib/auditLog";

const router = Router();

// ─── Public presets (no auth required) ──────────────────────────────────────

/**
 * GET /risk-profile/presets
 * Returns the platform-defined preset values for all named profiles.
 * Useful for the UI to render comparison tables without exposing this in JS.
 */
router.get("/presets", (_req, res) => {
  return res.json(RISK_PRESETS);
});

// ─── User routes ─────────────────────────────────────────────────────────────

/**
 * GET /risk-profile
 * Returns the user's saved profile row plus its resolved effective limits.
 */
router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const profile = await getRiskProfile(userId);
    const effectiveLimits = resolveEffectiveLimits(profile);
    return res.json({ profile, effectiveLimits });
  } catch (err) {
    req.log.error(err, "Failed to get risk profile");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /risk-profile
 * Update profile type and/or individual field overrides.
 *
 * - Changing only profileType resets all overrides to null (preset defaults).
 *   Pass keepOverrides: true to preserve existing overrides when switching type.
 * - Setting an override to null explicitly clears it (falls back to preset).
 * - For the `custom` profile, null overrides are treated as unconstrained.
 *
 * Body (all optional):
 *   profileType, maxRiskPerTrade, maxPortfolioRisk, maxSimultaneousTrades,
 *   maxDrawdownTolerance, keepOverrides
 */
router.put("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body as {
    profileType?: unknown;
    maxRiskPerTrade?: unknown;
    maxPortfolioRisk?: unknown;
    maxSimultaneousTrades?: unknown;
    maxDrawdownTolerance?: unknown;
    keepOverrides?: unknown;
  };

  // ── Validate profileType ──────────────────────────────────────────────────
  if (
    body.profileType !== undefined &&
    !(RISK_PROFILE_TYPES as readonly unknown[]).includes(body.profileType)
  ) {
    return res.status(400).json({
      error: `profileType must be one of: ${RISK_PROFILE_TYPES.join(", ")}`,
    });
  }

  // ── Validate numeric override fields ─────────────────────────────────────
  const pctField = (name: string, val: unknown): { value: number | null } | { error: string } => {
    if (val === null || val === undefined) return { value: null };
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0 || n > 100)
      return { error: `${name} must be a number between 0 and 100, or null to clear the override` };
    return { value: n };
  };

  const intField = (name: string, val: unknown): { value: number | null } | { error: string } => {
    if (val === null || val === undefined) return { value: null };
    const n = Number(val);
    if (!Number.isInteger(n) || n < 1)
      return { error: `${name} must be a positive integer, or null to clear the override` };
    return { value: n };
  };

  const parsedRiskPerTrade =
    body.maxRiskPerTrade !== undefined ? pctField("maxRiskPerTrade", body.maxRiskPerTrade) : null;
  const parsedPortfolioRisk =
    body.maxPortfolioRisk !== undefined
      ? pctField("maxPortfolioRisk", body.maxPortfolioRisk)
      : null;
  const parsedSimultaneous =
    body.maxSimultaneousTrades !== undefined
      ? intField("maxSimultaneousTrades", body.maxSimultaneousTrades)
      : null;
  const parsedDrawdown =
    body.maxDrawdownTolerance !== undefined
      ? pctField("maxDrawdownTolerance", body.maxDrawdownTolerance)
      : null;

  if (parsedRiskPerTrade && "error" in parsedRiskPerTrade)
    return res.status(400).json({ error: parsedRiskPerTrade.error });
  if (parsedPortfolioRisk && "error" in parsedPortfolioRisk)
    return res.status(400).json({ error: parsedPortfolioRisk.error });
  if (parsedSimultaneous && "error" in parsedSimultaneous)
    return res.status(400).json({ error: parsedSimultaneous.error });
  if (parsedDrawdown && "error" in parsedDrawdown)
    return res.status(400).json({ error: parsedDrawdown.error });

  const noChanges =
    body.profileType === undefined &&
    parsedRiskPerTrade === null &&
    parsedPortfolioRisk === null &&
    parsedSimultaneous === null &&
    parsedDrawdown === null;

  if (noChanges) {
    return res.status(400).json({ error: "Provide at least one field to update" });
  }

  try {
    const existing = await getRiskProfile(userId);
    const keepOverrides = body.keepOverrides === true;

    // When switching profileType without keepOverrides, clear all overrides so
    // the user starts fresh with the new preset's defaults.
    const clearOverrides =
      body.profileType !== undefined &&
      body.profileType !== existing.profileType &&
      !keepOverrides;

    const patch: Parameters<typeof saveRiskProfile>[1] = {
      ...(body.profileType !== undefined
        ? { profileType: body.profileType as RiskProfileType }
        : {}),
      ...(parsedRiskPerTrade !== null
        ? { maxRiskPerTrade: parsedRiskPerTrade.value }
        : clearOverrides
        ? { maxRiskPerTrade: null }
        : {}),
      ...(parsedPortfolioRisk !== null
        ? { maxPortfolioRisk: parsedPortfolioRisk.value }
        : clearOverrides
        ? { maxPortfolioRisk: null }
        : {}),
      ...(parsedSimultaneous !== null
        ? { maxSimultaneousTrades: parsedSimultaneous.value }
        : clearOverrides
        ? { maxSimultaneousTrades: null }
        : {}),
      ...(parsedDrawdown !== null
        ? { maxDrawdownTolerance: parsedDrawdown.value }
        : clearOverrides
        ? { maxDrawdownTolerance: null }
        : {}),
    };

    const saved = await saveRiskProfile(userId, patch);
    const effectiveLimits = resolveEffectiveLimits(saved);

    await logAudit(userId, "trading.risk_profile_updated", "user", userId, {
      previousProfileType: existing.profileType,
      newProfileType: saved.profileType,
      overrides: {
        maxRiskPerTrade: saved.maxRiskPerTrade,
        maxPortfolioRisk: saved.maxPortfolioRisk,
        maxSimultaneousTrades: saved.maxSimultaneousTrades,
        maxDrawdownTolerance: saved.maxDrawdownTolerance,
      },
    });

    return res.json({ profile: saved, effectiveLimits });
  } catch (err) {
    req.log.error(err, "Failed to update risk profile");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /risk-profile/validate
 *
 * Validate a risk proposal against the user's effective ceilings.
 * Used by the EA before submitting an order, and by the dashboard's risk
 * calculator widget.
 *
 * Body (all optional — check only the dimensions you provide):
 *   riskPerTrade    — % of account balance at risk for the new trade
 *   portfolioRisk   — total % open risk after this trade is added
 *   openPositions   — number of open positions AFTER adding this trade
 *   drawdown        — current drawdown %
 *
 * Returns { allowed, violations, effectiveLimits }.
 */
router.post("/validate", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body as {
    riskPerTrade?: unknown;
    portfolioRisk?: unknown;
    openPositions?: unknown;
    drawdown?: unknown;
  };

  const num = (v: unknown): number | undefined => {
    if (v === undefined || v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  if (
    body.riskPerTrade === undefined &&
    body.portfolioRisk === undefined &&
    body.openPositions === undefined &&
    body.drawdown === undefined
  ) {
    return res.status(400).json({
      error: "Provide at least one of: riskPerTrade, portfolioRisk, openPositions, drawdown",
    });
  }

  try {
    const result = await validateRisk(userId, {
      riskPerTrade: num(body.riskPerTrade),
      portfolioRisk: num(body.portfolioRisk),
      openPositions: num(body.openPositions),
      drawdown: num(body.drawdown),
    });
    return res.json(result);
  } catch (err) {
    req.log.error(err, "Failed to validate risk");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /risk-profile/effective-limits
 * Returns ONLY the resolved effective ceilings without the raw profile row.
 * Useful for lightweight ceiling checks in the UI without re-deriving them.
 */
router.get("/effective-limits", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const limits = await effectiveRiskLimit(userId);
    return res.json(limits);
  } catch (err) {
    req.log.error(err, "Failed to get effective risk limits");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
