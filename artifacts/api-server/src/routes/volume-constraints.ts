/**
 * Broker Volume Constraints Routes
 *
 * EA-facing (API key auth):
 *   POST /volume-constraints          — EA reports symbol constraints on init
 *
 * User-facing (session auth):
 *   GET  /volume-constraints          — list all constraints for the user's EA registrations
 *   GET  /volume-constraints/:symbol  — constraints for one symbol
 *   POST /volume-constraints/normalize — normalize + validate a raw volume
 */
import { Router } from "express";
import { getAuth } from "../lib/auth";
import {
  db,
  brokerVolumeConstraintsTable,
  eaRegistrationsTable,
  apiKeysTable,
  type RoundingPolicyEnum,
  ROUNDING_POLICIES,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireApiKeyAuth } from "../middlewares/requireApiKeyAuth";
import { normalizeVolume, validateVolume } from "../lib/volumeNormalizer";

const router = Router();

// ─── EA-facing ───────────────────────────────────────────────────────────────

/**
 * POST /volume-constraints
 *
 * Called by the EA during OnInit for every active symbol.  Upserts the
 * broker-reported SYMBOL_VOLUME_MIN / MAX / STEP for that symbol so the
 * platform can apply server-side normalisation and validation.
 *
 * Body: array of constraint objects — one per symbol.
 * The EA may also pass a roundingPolicy override per symbol; defaults to
 * ROUND_DOWN if omitted.
 *
 * Auth: EA API key (x-api-key / x-hardware-id headers).
 */
router.post("/", requireApiKeyAuth, async (req, res) => {
  const auth = req.eaAuth!;

  const raw = req.body as unknown;
  if (!Array.isArray(raw) || raw.length === 0) {
    return res.status(400).json({ error: "Body must be a non-empty array of constraint objects" });
  }

  type ConstraintInput = {
    symbol?: unknown;
    volumeMin?: unknown;
    volumeMax?: unknown;
    volumeStep?: unknown;
    roundingPolicy?: unknown;
  };

  const parsed: Array<{
    canonicalSymbol: string;
    volumeMin: number;
    volumeMax: number;
    volumeStep: number;
    roundingPolicy: RoundingPolicyEnum;
  }> = [];

  for (const item of raw as ConstraintInput[]) {
    if (typeof item.symbol !== "string" || !item.symbol.trim()) {
      return res.status(400).json({ error: "Each entry must have a non-empty 'symbol' string" });
    }
    const min = Number(item.volumeMin);
    const max = Number(item.volumeMax);
    const step = Number(item.volumeStep);
    if (!Number.isFinite(min) || min < 0) {
      return res.status(400).json({ error: `volumeMin must be a non-negative number (got ${item.volumeMin})` });
    }
    if (!Number.isFinite(max) || max <= 0) {
      return res.status(400).json({ error: `volumeMax must be a positive number (got ${item.volumeMax})` });
    }
    if (!Number.isFinite(step) || step <= 0) {
      return res.status(400).json({ error: `volumeStep must be a positive number (got ${item.volumeStep})` });
    }
    if (min > max) {
      return res.status(400).json({ error: `volumeMin (${min}) must be ≤ volumeMax (${max})` });
    }
    const policy: RoundingPolicyEnum =
      typeof item.roundingPolicy === "string" &&
      (ROUNDING_POLICIES as readonly string[]).includes(item.roundingPolicy)
        ? (item.roundingPolicy as RoundingPolicyEnum)
        : "ROUND_DOWN";

    parsed.push({ canonicalSymbol: item.symbol.trim().toUpperCase(), volumeMin: min, volumeMax: max, volumeStep: step, roundingPolicy: policy });
  }

  try {
    const upserted = await Promise.all(
      parsed.map((c) =>
        db
          .insert(brokerVolumeConstraintsTable)
          .values({
            eaRegistrationId: auth.eaRegistrationId,
            canonicalSymbol: c.canonicalSymbol,
            volumeMin: c.volumeMin,
            volumeMax: c.volumeMax,
            volumeStep: c.volumeStep,
            roundingPolicy: c.roundingPolicy,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              brokerVolumeConstraintsTable.eaRegistrationId,
              brokerVolumeConstraintsTable.canonicalSymbol,
            ],
            set: {
              volumeMin: c.volumeMin,
              volumeMax: c.volumeMax,
              volumeStep: c.volumeStep,
              roundingPolicy: c.roundingPolicy,
              updatedAt: new Date(),
            },
          })
          .returning(),
      ),
    );

    return res.status(200).json({ upserted: upserted.map((rows) => rows[0]) });
  } catch (err) {
    req.log.error(err, "Failed to upsert volume constraints");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── User-facing ─────────────────────────────────────────────────────────────

/**
 * GET /volume-constraints
 *
 * Returns all volume constraints stored for the current user's EA registrations.
 * Auth: session.
 */
router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    // Resolve all EA registration IDs belonging to this user (via API keys).
    const userKeys = await db
      .select({ id: apiKeysTable.id })
      .from(apiKeysTable)
      .where(eq(apiKeysTable.userId, userId));

    if (userKeys.length === 0) return res.json([]);

    const keyIds = userKeys.map((k) => k.id);
    const registrations = await db
      .select({ id: eaRegistrationsTable.id })
      .from(eaRegistrationsTable)
      .where(inArray(eaRegistrationsTable.apiKeyId, keyIds));

    if (registrations.length === 0) return res.json([]);

    const regIds = registrations.map((r) => r.id);
    const constraints = await db
      .select()
      .from(brokerVolumeConstraintsTable)
      .where(inArray(brokerVolumeConstraintsTable.eaRegistrationId, regIds))
      .orderBy(brokerVolumeConstraintsTable.canonicalSymbol);

    return res.json(constraints);
  } catch (err) {
    req.log.error(err, "Failed to list volume constraints");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /volume-constraints/normalize
 *
 * Normalize and validate a raw volume against stored broker constraints for
 * a given symbol and EA registration.
 *
 * Body: { symbol, rawVolume, eaRegistrationId, roundingPolicy? }
 * Auth: session.
 */
router.post("/normalize", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { symbol, rawVolume, eaRegistrationId, roundingPolicy } = req.body as {
    symbol?: unknown;
    rawVolume?: unknown;
    eaRegistrationId?: unknown;
    roundingPolicy?: unknown;
  };

  if (typeof symbol !== "string" || !symbol.trim()) {
    return res.status(400).json({ error: "'symbol' is required" });
  }
  const raw = Number(rawVolume);
  if (!Number.isFinite(raw) || raw <= 0) {
    return res.status(400).json({ error: "'rawVolume' must be a positive number" });
  }
  const regId = Number(eaRegistrationId);
  if (!Number.isInteger(regId) || regId <= 0) {
    return res.status(400).json({ error: "'eaRegistrationId' must be a positive integer" });
  }

  try {
    // Verify the registration belongs to this user.
    const userKeys = await db
      .select({ id: apiKeysTable.id })
      .from(apiKeysTable)
      .where(eq(apiKeysTable.userId, userId));

    const keyIds = userKeys.map((k) => k.id);
    const [reg] = await db
      .select()
      .from(eaRegistrationsTable)
      .where(
        and(
          eq(eaRegistrationsTable.id, regId),
          inArray(eaRegistrationsTable.apiKeyId, keyIds),
        ),
      )
      .limit(1);

    if (!reg) return res.status(403).json({ error: "EA registration not found or not owned by this user" });

    // Fetch constraints.
    const canonicalSymbol = symbol.trim().toUpperCase();
    const [constraint] = await db
      .select()
      .from(brokerVolumeConstraintsTable)
      .where(
        and(
          eq(brokerVolumeConstraintsTable.eaRegistrationId, regId),
          eq(brokerVolumeConstraintsTable.canonicalSymbol, canonicalSymbol),
        ),
      )
      .limit(1);

    if (!constraint) {
      return res.status(404).json({
        error: `No volume constraints found for symbol '${canonicalSymbol}' on EA registration ${regId}. EA must report constraints via POST /volume-constraints during OnInit.`,
      });
    }

    // Use request-supplied policy if valid, else the stored default.
    const policy: RoundingPolicyEnum =
      typeof roundingPolicy === "string" &&
      (ROUNDING_POLICIES as readonly string[]).includes(roundingPolicy)
        ? (roundingPolicy as RoundingPolicyEnum)
        : constraint.roundingPolicy;

    const normalized = normalizeVolume(raw, constraint.volumeStep, policy);
    const validation = validateVolume(normalized, constraint.volumeMin, constraint.volumeMax);

    return res.json({
      symbol: canonicalSymbol,
      rawVolume: raw,
      normalizedVolume: normalized,
      ok: validation.ok,
      error: validation.error ?? null,
      constraints: {
        volumeMin: constraint.volumeMin,
        volumeMax: constraint.volumeMax,
        volumeStep: constraint.volumeStep,
        roundingPolicy: policy,
      },
    });
  } catch (err) {
    req.log.error(err, "Failed to normalize volume");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /volume-constraints/:symbol
 *
 * Returns the volume constraints for a specific symbol across all of the
 * user's EA registrations.
 * Auth: session.
 */
router.get("/:symbol", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const canonicalSymbol = req.params.symbol.toUpperCase();

  try {
    const userKeys = await db
      .select({ id: apiKeysTable.id })
      .from(apiKeysTable)
      .where(eq(apiKeysTable.userId, userId));

    if (userKeys.length === 0) return res.json([]);

    const keyIds = userKeys.map((k) => k.id);
    const registrations = await db
      .select({ id: eaRegistrationsTable.id })
      .from(eaRegistrationsTable)
      .where(inArray(eaRegistrationsTable.apiKeyId, keyIds));

    if (registrations.length === 0) return res.json([]);

    const regIds = registrations.map((r) => r.id);
    const constraints = await db
      .select()
      .from(brokerVolumeConstraintsTable)
      .where(
        and(
          inArray(brokerVolumeConstraintsTable.eaRegistrationId, regIds),
          eq(brokerVolumeConstraintsTable.canonicalSymbol, canonicalSymbol),
        ),
      );

    return res.json(constraints);
  } catch (err) {
    req.log.error(err, "Failed to fetch volume constraints for symbol");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
