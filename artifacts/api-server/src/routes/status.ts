import { Router } from "express";
import { db, platformStatusTable, statusIncidentsTable, maintenanceBannerTable } from "@workspace/db";
import { desc, eq, ne } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

async function getMaintenanceOverride(): Promise<boolean> {
  const [banner] = await db.select().from(maintenanceBannerTable).where(eq(maintenanceBannerTable.id, 1));
  if (!banner || !banner.isEnabled) return false;
  const now = new Date();
  if (banner.startsAt && now < banner.startsAt) return false;
  if (banner.endsAt && now > banner.endsAt) return false;
  return true;
}

// GET /status/active — public: current effective status + open incidents.
// Overridden to "maintenance" whenever the site-wide maintenance banner is
// currently active, computed live rather than duplicated into this table.
router.get("/active", async (req, res) => {
  try {
    const [status] = await db.select().from(platformStatusTable).where(eq(platformStatusTable.id, 1));
    const maintenanceActive = await getMaintenanceOverride();
    const incidents = await db
      .select()
      .from(statusIncidentsTable)
      .where(ne(statusIncidentsTable.status, "resolved"))
      .orderBy(desc(statusIncidentsTable.createdAt));
    const recentResolved = await db
      .select()
      .from(statusIncidentsTable)
      .where(eq(statusIncidentsTable.status, "resolved"))
      .orderBy(desc(statusIncidentsTable.resolvedAt))
      .limit(5);

    return res.json({
      status: maintenanceActive ? "maintenance" : (status?.status ?? "operational"),
      updatedAt: status?.updatedAt ?? null,
      incidents,
      recentResolved,
    });
  } catch (err) {
    req.log.error(err, "Failed to get active status");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /status/admin — admin: raw stored status + all incidents
router.get("/admin", requireAdmin, async (req, res) => {
  try {
    const [status] = await db.select().from(platformStatusTable).where(eq(platformStatusTable.id, 1));
    const incidents = await db.select().from(statusIncidentsTable).orderBy(desc(statusIncidentsTable.createdAt));
    return res.json({ status: status ?? { id: 1, status: "operational", updatedAt: null }, incidents });
  } catch (err) {
    req.log.error(err, "Failed to get admin status");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /status/admin — admin: update the overall stored status
router.patch("/admin", requireAdmin, async (req, res) => {
  const { status } = req.body as { status?: "operational" | "degraded" | "partial_outage" | "major_outage" };
  if (!status) return res.status(400).json({ error: "status is required" });

  try {
    const [updated] = await db
      .insert(platformStatusTable)
      .values({ id: 1, status, updatedAt: new Date() })
      .onConflictDoUpdate({ target: platformStatusTable.id, set: { status, updatedAt: new Date() } })
      .returning();
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to update platform status");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /status/admin/incidents — admin: create an incident
router.post("/admin/incidents", requireAdmin, async (req, res) => {
  const { title, message, impact } = req.body as { title?: string; message?: string; impact?: string };
  if (!title || !message) return res.status(400).json({ error: "title and message are required" });

  try {
    const [incident] = await db.insert(statusIncidentsTable).values(req.body).returning();
    return res.status(201).json(incident);
  } catch (err) {
    req.log.error(err, "Failed to create status incident");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /status/admin/incidents/:id — admin: update an incident (message/status/impact)
router.patch("/admin/incidents/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { status } = req.body as { status?: string };
  try {
    const [incident] = await db
      .update(statusIncidentsTable)
      .set({
        ...req.body,
        updatedAt: new Date(),
        ...(status === "resolved" && { resolvedAt: new Date() }),
      })
      .where(eq(statusIncidentsTable.id, id))
      .returning();
    if (!incident) return res.status(404).json({ error: "Not found" });
    return res.json(incident);
  } catch (err) {
    req.log.error(err, "Failed to update status incident");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /status/admin/incidents/:id — admin
router.delete("/admin/incidents/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    await db.delete(statusIncidentsTable).where(eq(statusIncidentsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete status incident");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
