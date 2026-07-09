import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, apiKeysTable, eaRegistrationsTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import crypto from "crypto";
import { requireAdmin, isAdmin } from "../middlewares/requireAdmin";
import { checkApiAccess } from "../lib/entitlementEngine";
import { logAudit } from "../lib/auditLog";
import { generateSigningSecret } from "../lib/eaRequestSigning";

const router = Router();

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function generateRawKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const rawKey = `sig_${crypto.randomBytes(32).toString("hex")}`;
  return { rawKey, keyHash: hashKey(rawKey), keyPrefix: rawKey.slice(0, 12) + "..." };
}

/** Lazily flips an ACTIVE key to EXPIRED if its expiry has passed. Returns the (possibly updated) row. */
async function withLazyExpiry<T extends { id: number; status: string; expiresAt: Date | null }>(key: T): Promise<T> {
  if (key.status === "active" && key.expiresAt && key.expiresAt.getTime() < Date.now()) {
    const [updated] = await db.update(apiKeysTable)
      .set({ status: "expired" })
      .where(eq(apiKeysTable.id, key.id))
      .returning();
    return updated as unknown as T;
  }
  return key;
}

// ─── User-facing ────────────────────────────────────────────────────────────

// List current user's API keys
router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const keys = await db.select().from(apiKeysTable).where(eq(apiKeysTable.userId, userId));
    const withExpiry = await Promise.all(keys.map(withLazyExpiry));
    // Never re-expose the signing secret after issuance.
    return res.json(withExpiry.map(({ signingSecret, ...rest }) => rest));
  } catch (err) {
    req.log.error(err, "Failed to list API keys");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Create a new API key
router.post("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { name, expiresInDays } = req.body as { name?: string; expiresInDays?: number };
  if (!name) return res.status(400).json({ error: "name required" });

  const apiAccess = await checkApiAccess(userId);
  if (!apiAccess.allowed) {
    return res.status(403).json({ error: apiAccess.message, code: apiAccess.code });
  }

  try {
    const { rawKey, keyHash, keyPrefix } = generateRawKey();
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;
    // S29 — every newly-issued key gets a signing secret so EA HTTP requests
    // made with it are signed + replay-protected (see eaRequestSigning.ts).
    const signingSecret = generateSigningSecret();

    const [keyRow] = await db.insert(apiKeysTable).values({
      userId,
      name,
      keyHash,
      keyPrefix,
      status: "active",
      expiresAt,
      signingSecret,
    }).returning();

    await logAudit(userId, "api_key.created", "api_key", String(keyRow.id), { name });

    // Return full key + signing secret ONCE — neither is stored in plaintext
    // recoverable form after this point (the key is one-way hashed; the
    // secret is stored so the server can verify signatures, but is never
    // returned by any subsequent read endpoint).
    return res.status(201).json({
      ...keyRow,
      key: rawKey,
      signingSecret,
      warning: "Save this key — it will not be shown again.",
    });
  } catch (err) {
    req.log.error(err, "Failed to create API key");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Revoke an API key (owner or admin)
router.post("/:id/revoke", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [existing] = await db.select().from(apiKeysTable).where(eq(apiKeysTable.id, id));
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.userId !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const [key] = await db.update(apiKeysTable)
      .set({ status: "revoked" })
      .where(eq(apiKeysTable.id, id))
      .returning();
    await logAudit(userId, "api_key.revoked", "api_key", String(id), { name: existing.name });
    const { signingSecret, ...safeKey } = key;
    return res.json(safeKey);
  } catch (err) {
    req.log.error(err, "Failed to revoke API key");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Rotate an API key — same id/registrations, new secret (owner or admin)
router.post("/:id/rotate", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [existing] = await db.select().from(apiKeysTable).where(eq(apiKeysTable.id, id));
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.userId !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (existing.status === "revoked") {
      return res.status(400).json({ error: "Cannot rotate a revoked key — create a new one instead" });
    }

    const { rawKey, keyHash, keyPrefix } = generateRawKey();
    const signingSecret = generateSigningSecret();
    const [key] = await db.update(apiKeysTable)
      .set({ keyHash, keyPrefix, status: "active", signingSecret })
      .where(eq(apiKeysTable.id, id))
      .returning();

    await logAudit(userId, "api_key.rotated", "api_key", String(id), { name: existing.name });

    const { signingSecret: _omit, ...safeKey } = key;
    return res.json({
      ...safeKey,
      key: rawKey,
      signingSecret,
      warning: "Save this key and signing secret — neither will be shown again. Existing EA terminals must be updated.",
    });
  } catch (err) {
    req.log.error(err, "Failed to rotate API key");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// List registrations (terminals) for a key (owner or admin)
router.get("/:id/registrations", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [existing] = await db.select().from(apiKeysTable).where(eq(apiKeysTable.id, id));
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.userId !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const registrations = await db.select().from(eaRegistrationsTable).where(eq(eaRegistrationsTable.apiKeyId, id));
    return res.json(registrations);
  } catch (err) {
    req.log.error(err, "Failed to list EA registrations");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Verify an API key — used by EA runtime (public endpoint, key in header)
router.post("/verify", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string | undefined
    ?? (req.body as { key?: string }).key;
  if (!apiKey) return res.status(400).json({ error: "API key required" });

  try {
    const keyHash = hashKey(apiKey);
    const [key] = await db.select().from(apiKeysTable).where(eq(apiKeysTable.keyHash, keyHash));
    if (!key) return res.status(401).json({ error: "Invalid API key" });

    const current = await withLazyExpiry(key);
    if (current.status !== "active") {
      return res.status(401).json({ error: `API key is ${current.status}` });
    }

    await db.update(apiKeysTable).set({ lastUsedAt: new Date() }).where(eq(apiKeysTable.id, key.id));

    return res.json({ ok: true, userId: key.userId, keyId: key.id, status: current.status });
  } catch (err) {
    req.log.error(err, "Failed to verify API key");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin ──────────────────────────────────────────────────────────────────

// List all API keys across all users, with terminal usage counts
router.get("/all", requireAdmin, async (req, res) => {
  try {
    const keys = await db.select().from(apiKeysTable);
    const withExpiry = await Promise.all(keys.map(withLazyExpiry));

    const withUsage = await Promise.all(withExpiry.map(async (key) => {
      const [{ registrationCount }] = await db.select({ registrationCount: count() })
        .from(eaRegistrationsTable)
        .where(eq(eaRegistrationsTable.apiKeyId, key.id));
      const { signingSecret, ...safeKey } = key;
      return { ...safeKey, registrationCount };
    }));

    return res.json(withUsage);
  } catch (err) {
    req.log.error(err, "Failed to list all API keys");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Suspend a key (disable a suspected-compromised key without permanently revoking it)
router.post("/:id/suspend", requireAdmin, async (req, res) => {
  const { userId: actorUserId } = getAuth(req);
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [key] = await db.update(apiKeysTable)
      .set({ status: "suspended" })
      .where(eq(apiKeysTable.id, id))
      .returning();
    if (!key) return res.status(404).json({ error: "Not found" });
    await logAudit(actorUserId!, "api_key.suspended", "api_key", String(id), { name: key.name, userId: key.userId });
    const { signingSecret, ...safeKey } = key;
    return res.json(safeKey);
  } catch (err) {
    req.log.error(err, "Failed to suspend API key");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Reactivate a suspended key
router.post("/:id/reactivate", requireAdmin, async (req, res) => {
  const { userId: actorUserId } = getAuth(req);
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [existing] = await db.select().from(apiKeysTable).where(eq(apiKeysTable.id, id));
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.status !== "suspended") {
      return res.status(400).json({ error: "Only suspended keys can be reactivated" });
    }

    const [key] = await db.update(apiKeysTable)
      .set({ status: "active" })
      .where(eq(apiKeysTable.id, id))
      .returning();
    await logAudit(actorUserId!, "api_key.reactivated", "api_key", String(id), { name: existing.name, userId: existing.userId });
    const { signingSecret, ...safeKey } = key;
    return res.json(safeKey);
  } catch (err) {
    req.log.error(err, "Failed to reactivate API key");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Security report — status breakdown, expiring-soon keys, multi-hardware anomalies
router.get("/security-report", requireAdmin, async (req, res) => {
  try {
    const keys = await db.select().from(apiKeysTable);
    const withExpiry = await Promise.all(keys.map(withLazyExpiry));

    const statusBreakdown = withExpiry.reduce((acc: Record<string, number>, k) => {
      acc[k.status] = (acc[k.status] ?? 0) + 1;
      return acc;
    }, {});

    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const expiringSoon = withExpiry.filter(
      (k) => k.status === "active" && k.expiresAt && k.expiresAt.getTime() < sevenDaysFromNow.getTime(),
    );

    const staleThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const staleActiveKeys = withExpiry.filter(
      (k) => k.status === "active" && (!k.lastUsedAt || k.lastUsedAt.getTime() < staleThreshold.getTime()),
    );

    const registrations = await db.select().from(eaRegistrationsTable);
    const hardwareByKey = registrations.reduce((acc: Record<number, Set<string>>, r) => {
      if (!r.isActive) return acc;
      acc[r.apiKeyId] ??= new Set();
      acc[r.apiKeyId].add(r.hardwareId);
      return acc;
    }, {});

    // Flag keys active on an unusually high number of distinct terminals (possible sharing/leak)
    const MULTI_HARDWARE_THRESHOLD = 3;
    const multiHardwareAnomalies = Object.entries(hardwareByKey)
      .filter(([, hardwareIds]) => hardwareIds.size >= MULTI_HARDWARE_THRESHOLD)
      .map(([apiKeyId, hardwareIds]) => ({
        apiKeyId: Number(apiKeyId),
        distinctHardwareCount: hardwareIds.size,
      }));

    return res.json({
      totalKeys: withExpiry.length,
      statusBreakdown,
      expiringSoon: expiringSoon.map((k) => ({ id: k.id, name: k.name, userId: k.userId, expiresAt: k.expiresAt })),
      staleActiveKeys: staleActiveKeys.map((k) => ({ id: k.id, name: k.name, userId: k.userId, lastUsedAt: k.lastUsedAt })),
      multiHardwareAnomalies,
    });
  } catch (err) {
    req.log.error(err, "Failed to build security report");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
