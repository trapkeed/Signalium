import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  announcementsTable,
  notificationsTable,
  usersTable,
  subscriptionsTable,
  plansTable,
} from "@workspace/db";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";

const router = Router();

/** Resolves the list of Clerk user ids targeted by an announcement's audience. */
async function resolveAudienceUserIds(audience: "all" | "plan_tier", planTier: string | null): Promise<string[]> {
  if (audience === "all") {
    const users = await db.select({ id: usersTable.id }).from(usersTable);
    return users.map((u) => u.id);
  }

  if (!planTier) return [];
  const rows = await db
    .select({ userId: subscriptionsTable.userId })
    .from(subscriptionsTable)
    .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(and(eq(subscriptionsTable.status, "active"), eq(plansTable.tier, planTier as "starter" | "professional" | "enterprise")));
  return [...new Set(rows.map((r) => r.userId))];
}

// ---------------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------------

// GET /announcements — admin: list all announcements
router.get("/", requireAdmin, async (req, res) => {
  try {
    const announcements = await db.select().from(announcementsTable).orderBy(desc(announcementsTable.createdAt));
    return res.json(announcements);
  } catch (err) {
    req.log.error(err, "Failed to list announcements");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /announcements — admin: create a draft announcement
router.post("/", requireAdmin, async (req, res) => {
  const { title, body } = req.body as { title?: string; body?: string };
  if (!title || !body) return res.status(400).json({ error: "title and body are required" });

  try {
    const [announcement] = await db.insert(announcementsTable).values(req.body).returning();
    return res.status(201).json(announcement);
  } catch (err) {
    req.log.error(err, "Failed to create announcement");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /announcements/:id — admin: update a draft/published announcement's content
router.patch("/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [announcement] = await db
      .update(announcementsTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(announcementsTable.id, id))
      .returning();
    if (!announcement) return res.status(404).json({ error: "Not found" });
    return res.json(announcement);
  } catch (err) {
    req.log.error(err, "Failed to update announcement");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /announcements/:id — admin
router.delete("/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    await db.delete(announcementsTable).where(eq(announcementsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete announcement");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /announcements/:id/publish — admin: publish now and fan out a
// notification to every user in the announcement's audience. Fan-out is a
// one-time snapshot at publish time, not a live-updating audience.
router.post("/:id/publish", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [announcement] = await db.select().from(announcementsTable).where(eq(announcementsTable.id, id));
    if (!announcement) return res.status(404).json({ error: "Not found" });

    const userIds = await resolveAudienceUserIds(announcement.audience, announcement.planTier);
    if (userIds.length > 0) {
      await db.insert(notificationsTable).values(
        userIds.map((userId) => ({
          userId,
          type: "announcement" as const,
          title: announcement.title,
          body: announcement.body,
          announcementId: announcement.id,
        })),
      );
    }

    const [updated] = await db
      .update(announcementsTable)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(announcementsTable.id, id))
      .returning();

    await logAudit(actorUserId, "announcement.published", "announcement", String(updated.id), {
      title: updated.title,
      audience: updated.audience,
      notifiedUsers: userIds.length,
    });

    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to publish announcement");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /announcements/:id/retract — admin: stop showing the banner and
// prevent further publishes; already-delivered notifications are left in
// place as history.
router.post("/:id/retract", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [announcement] = await db
      .update(announcementsTable)
      .set({ status: "retracted", updatedAt: new Date() })
      .where(eq(announcementsTable.id, id))
      .returning();
    if (!announcement) return res.status(404).json({ error: "Not found" });

    await logAudit(actorUserId, "announcement.unpublished", "announcement", String(announcement.id), {
      title: announcement.title,
    });

    return res.json(announcement);
  } catch (err) {
    req.log.error(err, "Failed to retract announcement");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Authenticated: active banner-eligible announcements for the current user
// ---------------------------------------------------------------------------

// GET /announcements/banners — authenticated: published, non-expired
// announcements with showAsBanner=true that target the current user
// (audience "all", or "plan_tier" matching their active subscription).
router.get("/banners", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const now = new Date();
    const candidates = await db
      .select()
      .from(announcementsTable)
      .where(
        and(
          eq(announcementsTable.status, "published"),
          eq(announcementsTable.showAsBanner, true),
          or(isNull(announcementsTable.expiresAt), gt(announcementsTable.expiresAt, now)),
        ),
      )
      .orderBy(desc(announcementsTable.publishedAt));

    if (candidates.length === 0) return res.json([]);

    const [subscription] = await db
      .select({ tier: plansTable.tier })
      .from(subscriptionsTable)
      .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(and(eq(subscriptionsTable.userId, userId), eq(subscriptionsTable.status, "active")));

    const visible = candidates.filter(
      (a) => a.audience === "all" || (a.audience === "plan_tier" && a.planTier === subscription?.tier),
    );
    return res.json(visible);
  } catch (err) {
    req.log.error(err, "Failed to list announcement banners");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
