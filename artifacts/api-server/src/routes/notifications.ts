import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, notificationsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

const router = Router();

// GET /notifications — the current user's notification history, newest first.
router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const notifications = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, userId))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(100);
    return res.json(notifications);
  } catch (err) {
    req.log.error(err, "Failed to list notifications");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /notifications/unread-count — for the bell badge.
router.get("/unread-count", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const unread = await db
      .select()
      .from(notificationsTable)
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
    return res.json({ count: unread.length });
  } catch (err) {
    req.log.error(err, "Failed to count unread notifications");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /notifications/:id/read — mark a single notification as read.
router.post("/:id/read", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [notification] = await db
      .update(notificationsTable)
      .set({ isRead: true })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)))
      .returning();
    if (!notification) return res.status(404).json({ error: "Not found" });
    return res.json(notification);
  } catch (err) {
    req.log.error(err, "Failed to mark notification as read");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /notifications/read-all — mark every notification for the current user as read.
router.post("/read-all", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    await db
      .update(notificationsTable)
      .set({ isRead: true })
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to mark all notifications as read");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
