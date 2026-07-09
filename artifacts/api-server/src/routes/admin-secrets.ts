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
import { encryptSecret, decryptSecret, maskSecret } from "../lib/secretsVault";
import { logAudit } from "../lib/auditLog";
import { getGoogleCredentials, setGoogleCredentials } from "../lib/googleOAuth";

const router = Router();

// Known process.env-backed secrets the platform reads directly. Read-only
// here — actual rotation happens via Replit Secrets / the VPS environment.
const SYSTEM_ENV_KEYS: { key: string; category: string; description: string }[] = [
  { key: "DATABASE_URL", category: "db_credential", description: "PostgreSQL connection string." },
  { key: "SESSION_SECRET", category: "signing_key", description: "Signs sessions, tokens, and encrypts admin secrets." },
  { key: "QDE_TRAINER_URL", category: "other", description: "Base URL of the signalium-trainer service the QDE loop talks to." },
  { key: "QDE_TRAINER_API_KEY", category: "api_key", description: "Service credential used to authenticate to signalium-trainer." },
  { key: "QDE_RESEARCH_LAB_URL", category: "other", description: "Base URL of the Research Lab integration hub." },
  { key: "PRIVATE_OBJECT_DIR", category: "other", description: "Private object storage bucket path for EA builds/exports." },
  { key: "SECRETS_ENCRYPTION_KEY", category: "signing_key", description: "Optional dedicated key for this admin-secrets vault (falls back to SESSION_SECRET if unset)." },
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
