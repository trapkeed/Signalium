/**
 * Secure admin panel for API keys / env-style secrets used across the
 * platform. Two sources are merged into one view:
 *  - "managed" secrets: operator-entered values stored encrypted (AES-256-GCM)
 *    in `admin_secrets` (this router owns full CRUD, super_admin only).
 *  - "system" secrets: values that live in process.env / Replit Secrets and
 *    can never be edited from here (no write access to the host env from a
 *    request handler) — shown as configured/not-configured status only, to
 *    give admins one place to see everything the platform depends on.
 */
import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, adminSecretsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireSuperAdmin } from "../middlewares/requireAdmin";
import { encryptSecret, decryptSecret, maskSecret, resolveManagedConfig } from "../lib/secretsVault";
import { logAudit } from "../lib/auditLog";
import { getGoogleCredentials, setGoogleCredentials } from "../lib/googleOAuth";
import crypto from "crypto";
import { SETTINGS_DEFINITIONS, getDefinitionsByCategory, getTrainerRelevantKeys } from "../lib/settingsDefinitions";
import { getTrainerFailureState, checkTrainerReachability } from "../lib/qdeTrainer";

const router = Router();

// Known process.env-backed secrets the platform reads directly. Read-only
// here — actual rotation happens via Replit Secrets / the VPS environment.
const SYSTEM_ENV_KEYS: { key: string; category: string; description: string }[] = [
  { key: "DATABASE_URL", category: "infra", description: "PostgreSQL connection string." },
  { key: "SESSION_SECRET", category: "auth", description: "Signs sessions, tokens, and encrypts admin secrets." },
  { key: "QDE_TRAINER_URL", category: "trainer", description: "Base URL of the signalium-trainer service the QDE loop talks to." },
  { key: "QDE_TRAINER_API_KEY", category: "trainer", description: "Service credential used to authenticate to signalium-trainer." },
  { key: "QDE_RESEARCH_LAB_URL", category: "trainer", description: "Base URL of the Research Lab integration hub." },
  { key: "JWT_ISSUER", category: "auth", description: "Fallback SSO JWT issuer if no vault value (sso.issuer) is set." },
  { key: "JWT_EXPIRATION", category: "auth", description: "Fallback SSO access token TTL in seconds if no vault value (sso.access_token_ttl_seconds) is set." },
  { key: "JWT_REFRESH_EXPIRATION", category: "auth", description: "Fallback SSO refresh token TTL in days if no vault value (sso.refresh_token_ttl_days) is set." },
  { key: "PRIVATE_OBJECT_DIR", category: "infra", description: "Private object storage bucket path for EA builds/exports." },
  { key: "SECRETS_ENCRYPTION_KEY", category: "infra", description: "Optional dedicated key for this admin-secrets vault (falls back to SESSION_SECRET if unset)." },
];

router.get("/system", requireSuperAdmin, async (_req, res) => {
  const rows = SYSTEM_ENV_KEYS.map((def) => ({
    ...def,
    configured: !!process.env[def.key],
    source: "environment" as const,
  }));
  return res.json(rows);
});

router.get("/", requireSuperAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(adminSecretsTable);
    return res.json(rows.map((r) => ({
      id: r.id,
      key: r.key,
      category: r.category,
      description: r.description,
      isActive: r.isActive,
      rotatedAt: r.rotatedAt,
      maskedValue: (() => {
        try { return maskSecret(decryptSecret(r.encryptedValue)); } catch { return "••••••••"; }
      })(),
      updatedBy: r.updatedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })));
  } catch (err) {
    req.log.error(err, "Failed to list admin secrets");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Structured settings definitions (categories, sync-relevance) ─────────

router.get("/definitions", requireSuperAdmin, async (_req, res) => {
  return res.json({ definitions: SETTINGS_DEFINITIONS, byCategory: getDefinitionsByCategory() });
});

// System Settings page: for every known definition, report configured status
// pulled from whichever source (vault or env) actually backs it.
router.get("/settings-status", requireSuperAdmin, async (_req, res) => {
  const vaultRows = await db.select().from(adminSecretsTable);
  const vaultByKey = new Map(vaultRows.map((r) => [r.key, r]));

  const results = await Promise.all(SETTINGS_DEFINITIONS.map(async (def) => {
    const vaultRow = vaultByKey.get(def.key);
    const vaultConfigured = !!vaultRow && vaultRow.isActive;
    const envConfigured = def.envVarName ? !!process.env[def.envVarName] : (def.source === "env" ? !!process.env[def.key] : false);
    return {
      key: def.key,
      category: def.category,
      description: def.description,
      managePath: def.managePath,
      trainerRelevant: !!def.trainerRelevant,
      configured: vaultConfigured || envConfigured,
      configuredVia: vaultConfigured ? "vault" as const : envConfigured ? "env" as const : null,
      vaultDisabled: !!vaultRow && !vaultRow.isActive,
    };
  }));

  return res.json(results);
});

// ─── Synchronization status (read-only; no secrets ever leave Signalium) ──
// Computes a hash over the *non-secret* trainer-relevant config keys so
// operators can see at a glance whether the resolved trainer config has
// changed, without ever transmitting secret material to the trainer.
router.get("/sync-status", requireSuperAdmin, async (req, res) => {
  try {
    const reachability = await checkTrainerReachability();
    const trainerKeys = getTrainerRelevantKeys();
    const resolvedEntries = await Promise.all(trainerKeys.map(async (key) => {
      const def = SETTINGS_DEFINITIONS.find((d) => d.key === key)!;
      const value = await resolveManagedConfig(key, def.envVarName);
      return [key, value ?? null] as const;
    }));
    const configVersionInput = JSON.stringify(resolvedEntries.sort(([a], [b]) => a.localeCompare(b)));
    const configVersionHash = crypto.createHash("sha256").update(configVersionInput).digest("hex").slice(0, 16);

    return res.json({
      trainer: {
        configured: reachability.configured,
        reachable: reachability.reachable,
        latencyMs: reachability.latencyMs,
        error: reachability.error,
        checkedAt: new Date().toISOString(),
      },
      failureState: getTrainerFailureState(),
      configVersionHash,
      trainerRelevantKeyCount: trainerKeys.length,
      note: "Signalium never transmits secret values to the trainer — this status reflects reachability and a hash of non-secret, trainer-relevant configuration only.",
    });
  } catch (err) {
    req.log.error(err, "Failed to compute sync status");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Reveal the decrypted value — audited every time, super_admin only.
router.get("/:id/reveal", requireSuperAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [row] = await db.select().from(adminSecretsTable).where(eq(adminSecretsTable.id, id));
    if (!row) return res.status(404).json({ error: "Not found" });

    const value = decryptSecret(row.encryptedValue);
    await logAudit(userId, "admin_secret.revealed", "admin_secret", String(id), { key: row.key });
    return res.json({ key: row.key, value });
  } catch (err) {
    req.log.error(err, "Failed to reveal admin secret");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireSuperAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { key, value, category, description } = req.body as { key?: string; value?: string; category?: string; description?: string };
  if (!key || !value) return res.status(400).json({ error: "key and value are required" });

  try {
    const encryptedValue = encryptSecret(value);
    const [row] = await db.insert(adminSecretsTable).values({
      key,
      encryptedValue,
      category: (category as any) ?? "other",
      description,
      updatedBy: userId,
    }).returning();
    await logAudit(userId, "admin_secret.created", "admin_secret", String(row.id), { key });
    return res.status(201).json({ id: row.id, key: row.key, maskedValue: maskSecret(value) });
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ error: "A secret with this key already exists — use update instead" });
    req.log.error(err, "Failed to create admin secret");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", requireSuperAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { value, category, description } = req.body as { value?: string; category?: string; description?: string };

  try {
    const updates: Record<string, unknown> = { updatedBy: userId, updatedAt: new Date() };
    if (value !== undefined) updates.encryptedValue = encryptSecret(value);
    if (category !== undefined) updates.category = category;
    if (description !== undefined) updates.description = description;

    const [row] = await db.update(adminSecretsTable).set(updates).where(eq(adminSecretsTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    await logAudit(userId, "admin_secret.updated", "admin_secret", String(id), { key: row.key });
    return res.json({ id: row.id, key: row.key, maskedValue: maskSecret(decryptSecret(row.encryptedValue)) });
  } catch (err) {
    req.log.error(err, "Failed to update admin secret");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Rotate: replace the stored value while keeping the row (and its id/audit
// history) intact, distinct from delete + recreate.
router.post("/:id/rotate", requireSuperAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { value } = req.body as { value?: string };
  if (!value) return res.status(400).json({ error: "value is required" });

  try {
    const now = new Date();
    const [row] = await db.update(adminSecretsTable)
      .set({ encryptedValue: encryptSecret(value), rotatedAt: now, updatedAt: now, updatedBy: userId, isActive: true })
      .where(eq(adminSecretsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    await logAudit(userId, "admin_secret.rotated", "admin_secret", String(id), { key: row.key });
    return res.json({ id: row.id, key: row.key, maskedValue: maskSecret(value), rotatedAt: row.rotatedAt });
  } catch (err) {
    req.log.error(err, "Failed to rotate admin secret");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Disable: soft-disable so resolveManagedConfig() falls back to env, without
// deleting the stored (encrypted) value.
router.post("/:id/disable", requireSuperAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [row] = await db.update(adminSecretsTable)
      .set({ isActive: false, updatedAt: new Date(), updatedBy: userId })
      .where(eq(adminSecretsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    await logAudit(userId, "admin_secret.disabled", "admin_secret", String(id), { key: row.key });
    return res.json({ id: row.id, key: row.key, isActive: row.isActive });
  } catch (err) {
    req.log.error(err, "Failed to disable admin secret");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/enable", requireSuperAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [row] = await db.update(adminSecretsTable)
      .set({ isActive: true, updatedAt: new Date(), updatedBy: userId })
      .where(eq(adminSecretsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    await logAudit(userId, "admin_secret.enabled", "admin_secret", String(id), { key: row.key });
    return res.json({ id: row.id, key: row.key, isActive: row.isActive });
  } catch (err) {
    req.log.error(err, "Failed to enable admin secret");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", requireSuperAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [row] = await db.delete(adminSecretsTable).where(eq(adminSecretsTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    await logAudit(userId, "admin_secret.deleted", "admin_secret", String(id), { key: row.key });
    return res.json({ success: true });
  } catch (err) {
    req.log.error(err, "Failed to delete admin secret");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Google OAuth credentials — admin-configurable "Continue with Google" ──

router.get("/google-oauth", requireSuperAdmin, async (req, res) => {
  try {
    const creds = await getGoogleCredentials();
    return res.json({
      configured: !!creds,
      clientId: creds ? creds.clientId : null,
    });
  } catch (err) {
    req.log.error(err, "Failed to fetch Google OAuth status");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/google-oauth", requireSuperAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { clientId, clientSecret } = req.body as { clientId?: string; clientSecret?: string };
  if (!clientId || !clientSecret) return res.status(400).json({ error: "clientId and clientSecret are required" });

  try {
    await setGoogleCredentials(clientId, clientSecret, userId);
    await logAudit(userId, "admin_secret.updated", "oauth_credentials", "google", { key: "google_oauth" });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "Failed to set Google OAuth credentials");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
