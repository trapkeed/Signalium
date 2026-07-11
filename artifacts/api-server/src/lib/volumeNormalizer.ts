/**
 * Broker Volume Normalisation
 *
 * Provides server-side equivalents of the MQL5 volume functions embedded in
 * the EA.  All three exported helpers are pure where possible; only
 * getSymbolConstraints touches the database.
 *
 * The same rounding logic is also rendered into the EA at build time
 * (see eaBuilder.ts renderVolumeSectionMql5) so the EA can normalise volumes
 * locally without a round-trip, while the server validates any lot size it
 * receives.
 */

import type { RoundingPolicyEnum } from "@workspace/db";

export type { RoundingPolicyEnum };

export interface SymbolConstraints {
  canonicalSymbol: string;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
  roundingPolicy: RoundingPolicyEnum;
}

export interface ValidateVolumeResult {
  ok: boolean;
  /** Normalised volume (only meaningful when ok === true). */
  normalizedVolume: number;
  /** Human-readable rejection reason (only set when ok === false). */
  error?: string;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the number of decimal places implied by a step value so floating-
 * point artefacts (e.g. 0.30000000000000004) are eliminated after rounding.
 *
 * Examples:  0.01 → 2,  0.1 → 1,  1 → 0,  0.001 → 3
 */
function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 8;
  const s = step.toString();
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * Round `raw` to the nearest valid step multiple using the specified policy.
 *
 * Examples (step = 0.01, ROUND_DOWN):
 *   0.457 → 0.45
 * Examples (step = 0.01, ROUND_UP):
 *   0.457 → 0.46  (not 0.50 — step is 0.01, not 0.05)
 * Examples (step = 0.05, ROUND_UP):
 *   0.457 → 0.50
 */
export function normalizeVolume(
  raw: number,
  step: number,
  policy: RoundingPolicyEnum = "ROUND_DOWN",
): number {
  if (!Number.isFinite(raw) || !Number.isFinite(step) || step <= 0) return raw;

  const steps = raw / step;
  let rounded: number;

  switch (policy) {
    case "ROUND_UP":
      rounded = Math.ceil(steps) * step;
      break;
    case "ROUND_NEAREST":
      rounded = Math.round(steps) * step;
      break;
    case "ROUND_DOWN":
    default:
      rounded = Math.floor(steps) * step;
      break;
  }

  // Eliminate floating-point drift (e.g. 0.30000000000000004 → 0.30).
  return parseFloat(rounded.toFixed(stepDecimals(step)));
}

/**
 * Validate a (pre-normalised) volume against broker min/max constraints.
 *
 * Returns { ok: true, normalizedVolume } on success, or { ok: false, error }
 * when the volume falls outside the broker's permitted range.  The caller
 * must normalise first with normalizeVolume() before calling this.
 */
export function validateVolume(
  normalizedVolume: number,
  min: number,
  max: number,
): ValidateVolumeResult {
  if (!Number.isFinite(normalizedVolume)) {
    return { ok: false, normalizedVolume, error: "Volume is not a finite number" };
  }
  if (normalizedVolume < min) {
    return {
      ok: false,
      normalizedVolume,
      error: `Volume ${normalizedVolume} is below the minimum allowed (${min})`,
    };
  }
  if (normalizedVolume > max) {
    return {
      ok: false,
      normalizedVolume,
      error: `Volume ${normalizedVolume} exceeds the maximum allowed (${max})`,
    };
  }
  return { ok: true, normalizedVolume };
}

/**
 * Convenience wrapper: normalise then validate in one call.
 * Returns the normalised volume and whether it passes broker constraints.
 */
export function normalizeAndValidate(
  raw: number,
  constraints: Pick<SymbolConstraints, "volumeMin" | "volumeMax" | "volumeStep" | "roundingPolicy">,
): ValidateVolumeResult {
  const normalized = normalizeVolume(raw, constraints.volumeStep, constraints.roundingPolicy);
  return validateVolume(normalized, constraints.volumeMin, constraints.volumeMax);
}

// ─── DB-backed lookup ─────────────────────────────────────────────────────────

/**
 * Fetch broker volume constraints for a specific (eaRegistrationId, symbol)
 * pair from the database.  Returns null when the EA has not yet reported
 * constraints for this symbol (i.e. the EA hasn't called OnInit yet, or
 * the symbol wasn't active at the time).
 */
export async function getSymbolConstraints(
  eaRegistrationId: number,
  canonicalSymbol: string,
): Promise<SymbolConstraints | null> {
  const { db, brokerVolumeConstraintsTable } = await import("@workspace/db");
  const { eq, and } = await import("drizzle-orm");

  const [row] = await db
    .select()
    .from(brokerVolumeConstraintsTable)
    .where(
      and(
        eq(brokerVolumeConstraintsTable.eaRegistrationId, eaRegistrationId),
        eq(brokerVolumeConstraintsTable.canonicalSymbol, canonicalSymbol),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    canonicalSymbol: row.canonicalSymbol,
    volumeMin: row.volumeMin,
    volumeMax: row.volumeMax,
    volumeStep: row.volumeStep,
    roundingPolicy: row.roundingPolicy,
  };
}

/**
 * Fetch all broker volume constraints for a given EA registration.
 * Used by the platform when it needs to apply normalisation across all
 * symbols without knowing which symbol is active (e.g. portfolio review).
 */
export async function getAllConstraintsForRegistration(
  eaRegistrationId: number,
): Promise<SymbolConstraints[]> {
  const { db, brokerVolumeConstraintsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");

  const rows = await db
    .select()
    .from(brokerVolumeConstraintsTable)
    .where(eq(brokerVolumeConstraintsTable.eaRegistrationId, eaRegistrationId));

  return rows.map((r) => ({
    canonicalSymbol: r.canonicalSymbol,
    volumeMin: r.volumeMin,
    volumeMax: r.volumeMax,
    volumeStep: r.volumeStep,
    roundingPolicy: r.roundingPolicy,
  }));
}
