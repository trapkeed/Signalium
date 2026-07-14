import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, dataProvidersTable, adminSecretsTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";
import { getActiveProvider } from "../lib/marketData/registry";
import { oandaStream } from "../lib/marketData/oandaStream";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/secretsVault";

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

// ─── OANDA config ─────────────────────────────────────────────────────────────

const OANDA_CONFIG_KEYS = [
  {
    key: "market_data.oanda_api_key",
    label: "API Key",
    description: "Personal access token from OANDA (My Account → API Access → Generate).",
    optional: false,
  },
  {
    key: "market_data.oanda_account_id",
    label: "Account ID",
    description: "Your OANDA account ID — format 101-004-XXXXXXX-001. Found under Account Summary or in the URL after login.",
    optional: false,
  },
  {
    key: "market_data.oanda_stream_url",
    label: "Stream URL",
    description: "OANDA streaming base URL. Leave blank to use the demo default.",
    optional: true,
    defaultValue: "https://stream-fxpractice.oanda.com",
  },
  {
    key: "market_data.oanda_stream_symbols",
    label: "Symbols",
    description: "Comma-separated instruments to subscribe to. Leave blank for the default set.",
    optional: true,
    defaultValue: "EUR_USD,XAU_USD,GBP_USD",
  },
] as const;

/**
 * GET /data-providers/oanda/config
 * Returns the configuration status of all 4 OANDA vault keys — whether each
 * is set, and a masked preview of the value. Never reveals plaintext.
 */
router.get("/oanda/config", requireAdmin, async (req, res) => {
  try {
    const keys = OANDA_CONFIG_KEYS.map((k) => k.key);
    const rows = await db
      .select()
      .from(adminSecretsTable)
      .where(inArray(adminSecretsTable.key, keys));

    const rowByKey = new Map(rows.map((r) => [r.key, r]));

    const result = OANDA_CONFIG_KEYS.map((def) => {
      const row = rowByKey.get(def.key);
      const configured = !!row && row.isActive;
      let maskedValue: string | null = null;
      if (row) {
        try { maskedValue = maskSecret(decryptSecret(row.encryptedValue)); } catch { maskedValue = "••••••••"; }
      }
      return {
        key: def.key,
        label: def.label,
        description: def.description,
        optional: def.optional,
        defaultValue: (def as any).defaultValue ?? null,
        configured,
        maskedValue,
      };
    });

    return res.json(result);
  } catch (err) {
    req.log.error(err, "Failed to read OANDA config");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /data-providers/oanda/config
 * Upserts one or more OANDA vault keys. Only keys in the OANDA_CONFIG_KEYS
 * allowlist are accepted. Empty-string values are ignored (use DELETE via
 * Admin → Managed Secrets to remove a key).
 */
router.put("/oanda/config", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { fields } = req.body as { fields?: { key: string; value: string }[] };
  if (!Array.isArray(fields) || fields.length === 0) {
    return res.status(400).json({ error: "'fields' array is required" });
  }

  const allowedKeys = new Set<string>(OANDA_CONFIG_KEYS.map((k) => k.key));
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
        const def = OANDA_CONFIG_KEYS.find((k) => k.key === key)!;
        await db.insert(adminSecretsTable).values({
          key,
          encryptedValue,
          category: "market_data",
          description: def.description,
          updatedBy: userId,
        });
      }

      await logAudit(userId, "admin_secret.updated", "admin_secret", key, { key, category: "market_data" });
      saved.push(key);
    }

    return res.json({ saved });
  } catch (err) {
    req.log.error(err, "Failed to save OANDA config");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── OANDA stream status ──────────────────────────────────────────────────────

/**
 * GET /data-providers/oanda/stream-status
 * Returns the live OANDA streaming worker status: connection state, subscribed
 * symbols, per-symbol cached prices, tick count, and last heartbeat time.
 * Admin-only. Polled every 10 s by the admin data-providers UI.
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
