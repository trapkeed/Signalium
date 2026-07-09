import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, brokersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";
import { invalidateSymbolCache } from "../lib/symbolNormalizer";

const router = Router();

// List active brokers — used by symbol alias forms to attribute an alias to
// a broker, so any authenticated user can read this (not admin-gated).
router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const brokers = await db.select().from(brokersTable)
      .where(eq(brokersTable.isActive, true))
      .orderBy(brokersTable.name);
    return res.json(brokers);
  } catch (err) {
    req.log.error(err, "Failed to list brokers");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin ──────────────────────────────────────────────────────────────────

router.get("/admin", requireAdmin, async (req, res) => {
  try {
    const brokers = await db.select().from(brokersTable).orderBy(desc(brokersTable.createdAt));
    return res.json(brokers);
  } catch (err) {
    req.log.error(err, "Failed to list brokers");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const { name, slug, website, isActive } = req.body as { name?: string; slug?: string; website?: string; isActive?: boolean };
  if (!name || !slug) return res.status(400).json({ error: "'name' and 'slug' are required" });

  try {
    const [broker] = await db.insert(brokersTable).values({
      name,
      slug: slug.toLowerCase(),
      website: website || null,
      isActive: isActive ?? true,
    }).returning();
    await logAudit(userId!, "broker.created", "broker", String(broker.id), { name: broker.name });
    return res.status(201).json(broker);
  } catch (err) {
    req.log.error(err, "Failed to create broker");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/:id", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const id = Number(req.params.id);
  const { name, slug, website, isActive } = req.body as { name?: string; slug?: string; website?: string; isActive?: boolean };

  try {
    const [broker] = await db.update(brokersTable)
      .set({
        ...(name !== undefined && { name }),
        ...(slug !== undefined && { slug: slug.toLowerCase() }),
        ...(website !== undefined && { website: website || null }),
        ...(isActive !== undefined && { isActive }),
      })
      .where(eq(brokersTable.id, id))
      .returning();
    if (!broker) return res.status(404).json({ error: "Not found" });
    await logAudit(userId!, "broker.updated", "broker", String(broker.id), { name: broker.name });
    invalidateSymbolCache();
    return res.json(broker);
  } catch (err) {
    req.log.error(err, "Failed to update broker");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/:id", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const id = Number(req.params.id);
  try {
    const [deleted] = await db.delete(brokersTable).where(eq(brokersTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    await logAudit(userId!, "broker.deleted", "broker", String(id), { name: deleted.name });
    invalidateSymbolCache();
    return res.json(deleted);
  } catch (err) {
    req.log.error(err, "Failed to delete broker");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
