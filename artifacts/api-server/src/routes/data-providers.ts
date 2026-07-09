import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, dataProvidersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";
import { getActiveProvider } from "../lib/marketData/registry";

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
