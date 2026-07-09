import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, featureFlagsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";

const router = Router();

// GET /feature-flags — any authenticated user can read the current flag
// states, so the frontend can gate UI by key (e.g. useFeatureFlag("x")).
// Returned as a simple key -> enabled map to keep client-side gating cheap.
router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const flags = await db.select({ key: featureFlagsTable.key, enabled: featureFlagsTable.enabled }).from(featureFlagsTable);
    const map: Record<string, boolean> = {};
    for (const flag of flags) map[flag.key] = flag.enabled;
    return res.json(map);
  } catch (err) {
    req.log.error(err, "Failed to list feature flags");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin ──────────────────────────────────────────────────────────────────

router.get("/admin", requireAdmin, async (req, res) => {
  try {
    const flags = await db.select().from(featureFlagsTable).orderBy(desc(featureFlagsTable.createdAt));
    return res.json(flags);
  } catch (err) {
    req.log.error(err, "Failed to list feature flags");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const { key, label, description, enabled } = req.body as { key?: string; label?: string; description?: string; enabled?: boolean };
  if (!key || !label) return res.status(400).json({ error: "'key' and 'label' are required" });

  try {
    const [flag] = await db.insert(featureFlagsTable).values({
      key: key.toLowerCase().replace(/\s+/g, "_"),
      label,
      description: description || null,
      enabled: enabled ?? false,
    }).returning();
    await logAudit(userId!, "feature_flag.created", "feature_flag", String(flag.id), { key: flag.key });
    return res.status(201).json(flag);
  } catch (err) {
    req.log.error(err, "Failed to create feature flag");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/:id", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const id = Number(req.params.id);
  const { label, description, enabled } = req.body as { label?: string; description?: string; enabled?: boolean };

  try {
    const [flag] = await db.update(featureFlagsTable)
      .set({
        ...(label !== undefined && { label }),
        ...(description !== undefined && { description: description || null }),
        ...(enabled !== undefined && { enabled }),
        updatedAt: new Date(),
      })
      .where(eq(featureFlagsTable.id, id))
      .returning();
    if (!flag) return res.status(404).json({ error: "Not found" });
    await logAudit(userId!, "feature_flag.updated", "feature_flag", String(flag.id), { key: flag.key, enabled: flag.enabled });
    return res.json(flag);
  } catch (err) {
    req.log.error(err, "Failed to update feature flag");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/:id", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const id = Number(req.params.id);
  try {
    const [deleted] = await db.delete(featureFlagsTable).where(eq(featureFlagsTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    await logAudit(userId!, "feature_flag.deleted", "feature_flag", String(id), { key: deleted.key });
    return res.json(deleted);
  } catch (err) {
    req.log.error(err, "Failed to delete feature flag");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
