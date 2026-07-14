import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, dataProvidersTable, adminSecretsTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";
import { getActiveProvider } from "../lib/marketData/registry";
import { oandaStream } from "../lib/marketData/oandaStream";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/secretsVault";
import { getProviderConfigDef, ALL_PROVIDER_CONFIG_KEYS } from "../lib/marketData/providerConfigRegistry";

const router = Router();

/**
 * Resolves which provider is currently active for a role ("live" or
 * "historical"). This is the single point the rest of the platform should
 * call instead of hardcoding a provider — see lib/marketData/registry.ts.
 */
router.get("/active/:role", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const role = req.params.role;
  if (role !== "live" && role !== "historical") {
    return res.status(400).json({ error: "'role' must be 'live' or 'historical'" });
  }

  try {
    const active = await getActiveProvider(role);
    return res.json(active);
  } catch (err) {
    req.log.error(err, "Failed to resolve active provider");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const providers = await db.select().from(dataProvidersTable)
      .where(eq(dataProvidersTable.isActive, true))
      .orderBy(dataProvidersTable.name);
    return res.json(providers);
  } catch (err) {
    req.log.error(err, "Failed to list data providers");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Generic per-provider config ─────────────────────────────────────────────

/**
 * GET /data-providers/:slug/config
 * Returns the configuration status of every vault key defined for the given
 * provider slug — whether each is set, and a masked preview. Never reveals
 * plaintext. Returns 404 for unrecognised slugs.
 */
router.get("/:slug/config", requireAdmin, async (req, res) => {
  const slug = String(req.params.slug);
  const def = getProviderConfigDef(slug);
  if (!def) return res.status(404).json({ error: `No config definition for provider '${slug}'` });

  try {
    const keys = def.fields.map((f) => f.key);
    const rows = await db.select().from(adminSecretsTable).where(inArray(adminSecretsTable.key, keys));
    const rowByKey = new Map(rows.map((r) => [r.key, r]));

    const result = def.fields.map((field) => {
      const row = rowByKey.get(field.key);
      const configured = !!row && row.isActive;
      let maskedValue: string | null = null;
      if (row) {
        try { maskedValue = maskSecret(decryptSecret(row.encryptedValue)); } catch { maskedValue = "••••••••"; }
      }
      return {
        key: field.key,
        label: field.label,
        description: field.description,
        optional: field.optional,
        sensitive: field.sensitive,
        defaultValue: field.defaultValue ?? null,
        placeholder: field.placeholder ?? null,
        configured,
        maskedValue,
      };
    });

    return res.json(result);
  } catch (err) {
    req.log.error(err, "Failed to read provider config");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /data-providers/:slug/config
 * Upserts vault keys for the given provider. Only keys belonging to that
 * provider (via providerConfigRegistry) are accepted. Empty strings are
 * skipped — use Admin → Managed Secrets to delete a key.
 */
router.put("/:slug/config", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const slug = String(req.params.slug);
  const def = getProviderConfigDef(slug);
  if (!def) return res.status(404).json({ error: `No config definition for provider '${slug}'` });

  const { fields } = req.body as { fields?: { key: string; value: string }[] };
  if (!Array.isArray(fields) || fields.length === 0) {
    return res.status(400).json({ error: "'fields' array is required" });
  }

  const allowedKeys = new Set<string>(def.fields.map((f) => f.key));
  const saved: string[] = [];

  try {
    for (const { key, value } of fields) {
      if (!allowedKeys.has(key)) continue;
      if (!value || !value.trim()) continue;

      const encryptedValue = encryptSecret(value.trim());
      const existing = await db
        .select({ id: adminSecretsTable.id })
        .from(adminSecretsTable)
        .where(eq(adminSecretsTable.key, key))
        .limit(1);

      if (existing.length > 0) {
        await db.update(adminSecretsTable)
          .set({ encryptedValue, isActive: true, updatedBy: userId, updatedAt: new Date() })
          .where(eq(adminSecretsTable.key, key));
      } else {
        const fieldDef = def.fields.find((f) => f.key === key)!;
        await db.insert(adminSecretsTable).values({
          key,
          encryptedValue,
          category: "market_data",
          description: fieldDef.description,
          updatedBy: userId,
        });
      }

      await logAudit(userId, "admin_secret.updated", "admin_secret", key, { key, category: "market_data", provider: req.params.slug });
      saved.push(key);
    }

    return res.json({ saved });
  } catch (err) {
    req.log.error(err, "Failed to save provider config");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── OANDA stream status ──────────────────────────────────────────────────────

/**
 * GET /data-providers/oanda/stream-status
 * Returns the live OANDA streaming worker status: connection state, subscribed
 * symbols, per-symbol cached prices, tick count, and last heartbeat time.
 * Admin-only. Polled every 10 s by the admin data-providers UI.
 *
 * NOTE: must be defined BEFORE the generic /:slug/config routes so Express
 * does not mistake "oanda" for a slug and "stream-status" for "config".
 * Actually Express evaluates routes in registration order; since this file
 * mounts stream-status after /:slug/config it needs its own explicit path
 * rather than relying on order. Express matches the most specific path first
 * only for router.param, not middleware. To be safe this is a dedicated route.
 */
router.get("/oanda/stream-status", requireAdmin, (_req, res) => {
  return res.json(oandaStream.getStatus());
});

// ─── Admin ──────────────────────────────────────────────────────────────────

router.get("/admin", requireAdmin, async (req, res) => {
  try {
    const providers = await db.select().from(dataProvidersTable).orderBy(desc(dataProvidersTable.createdAt));
    return res.json(providers);
  } catch (err) {
    req.log.error(err, "Failed to list data providers");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const { name, slug, apiEndpoint, isActive } = req.body as { name?: string; slug?: string; apiEndpoint?: string; isActive?: boolean };
  if (!name || !slug) return res.status(400).json({ error: "'name' and 'slug' are required" });

  try {
    const [provider] = await db.insert(dataProvidersTable).values({
      name,
      slug: slug.toLowerCase(),
      apiEndpoint: apiEndpoint || null,
      isActive: isActive ?? true,
    }).returning();
    await logAudit(userId!, "data_provider.created", "data_provider", String(provider.id), { name: provider.name });
    return res.status(201).json(provider);
  } catch (err) {
    req.log.error(err, "Failed to create data provider");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/:id", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const id = Number(req.params.id);
  const { name, slug, apiEndpoint, isActive } = req.body as { name?: string; slug?: string; apiEndpoint?: string; isActive?: boolean };

  try {
    const [provider] = await db.update(dataProvidersTable)
      .set({
        ...(name !== undefined && { name }),
        ...(slug !== undefined && { slug: slug.toLowerCase() }),
        ...(apiEndpoint !== undefined && { apiEndpoint: apiEndpoint || null }),
        ...(isActive !== undefined && { isActive }),
      })
      .where(eq(dataProvidersTable.id, id))
      .returning();
    if (!provider) return res.status(404).json({ error: "Not found" });
    await logAudit(userId!, "data_provider.updated", "data_provider", String(provider.id), { name: provider.name });
    return res.json(provider);
  } catch (err) {
    req.log.error(err, "Failed to update data provider");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/:id", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const id = Number(req.params.id);
  try {
    const [deleted] = await db.delete(dataProvidersTable).where(eq(dataProvidersTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    await logAudit(userId!, "data_provider.deleted", "data_provider", String(id), { name: deleted.name });
    return res.json(deleted);
  } catch (err) {
    req.log.error(err, "Failed to delete data provider");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
