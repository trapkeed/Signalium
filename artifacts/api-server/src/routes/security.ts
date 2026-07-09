import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, securityIncidentsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";

const router = Router();

// Admin: list security incidents, filterable by type/severity/status.
router.get("/incidents", requireAdmin, async (req, res) => {
  const { type, severity, status } = req.query as { type?: string; severity?: string; status?: string };

  try {
    const conditions = [];
    if (type) conditions.push(eq(securityIncidentsTable.type, type as typeof securityIncidentsTable.$inferSelect["type"]));
    if (severity) conditions.push(eq(securityIncidentsTable.severity, severity as typeof securityIncidentsTable.$inferSelect["severity"]));
    if (status) conditions.push(eq(securityIncidentsTable.status, status as typeof securityIncidentsTable.$inferSelect["status"]));

    const rows = await db.select().from(securityIncidentsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(securityIncidentsTable.createdAt))
      .limit(500);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list security incidents");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: acknowledge or resolve an incident.
router.patch("/incidents/:id", requireAdmin, async (req, res) => {
  const { userId: actorUserId } = getAuth(req);
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { status } = req.body as { status?: "acknowledged" | "resolved" };
  if (status !== "acknowledged" && status !== "resolved") {
    return res.status(400).json({ error: "status must be 'acknowledged' or 'resolved'" });
  }

  try {
    const [existing] = await db.select().from(securityIncidentsTable).where(eq(securityIncidentsTable.id, id));
    if (!existing) return res.status(404).json({ error: "Not found" });

    const now = new Date();
    const [updated] = await db.update(securityIncidentsTable)
      .set(
        status === "acknowledged"
          ? { status: "acknowledged", acknowledgedBy: actorUserId, acknowledgedAt: now }
          : { status: "resolved", resolvedAt: now },
      )
      .where(eq(securityIncidentsTable.id, id))
      .returning();

    await logAudit(actorUserId!, status === "acknowledged" ? "security_incident.acknowledged" : "security_incident.resolved", "security_incident", String(id), { type: existing.type });

    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to update security incident");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
