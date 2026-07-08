import { Router } from "express";
import { db, usersTable, subscriptionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { GetUserParams, UpdateUserParams, UpdateUserBody } from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));

    const usersWithSubs = await Promise.all(users.map(async (user) => {
      const [sub] = await db.select().from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, user.id))
        .orderBy(desc(subscriptionsTable.createdAt))
        .limit(1);
      return { ...user, subscriptionStatus: sub?.status ?? null };
    }));

    return res.json(usersWithSubs);
  } catch (err) {
    req.log.error(err, "Failed to list users");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const parsed = GetUserParams.safeParse({ id: req.params.id });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, parsed.data.id));
    if (!user) return res.status(404).json({ error: "Not found" });

    const [sub] = await db.select().from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, user.id))
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(1);

    return res.json({ ...user, subscriptionStatus: sub?.status ?? null });
  } catch (err) {
    req.log.error(err, "Failed to get user");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  const params = UpdateUserParams.safeParse({ id: req.params.id });
  const body = UpdateUserBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  try {
    const [user] = await db.update(usersTable)
      .set({ ...body.data })
      .where(eq(usersTable.id, params.data.id))
      .returning();
    if (!user) return res.status(404).json({ error: "Not found" });
    return res.json({ ...user, subscriptionStatus: null });
  } catch (err) {
    req.log.error(err, "Failed to update user");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
