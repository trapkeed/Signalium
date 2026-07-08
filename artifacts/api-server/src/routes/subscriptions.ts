import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, subscriptionsTable, plansTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateSubscriptionBody,
  UpdateSubscriptionBody,
  UpdateSubscriptionParams,
  CancelSubscriptionParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const subs = await db
      .select({
        id: subscriptionsTable.id,
        userId: subscriptionsTable.userId,
        planId: subscriptionsTable.planId,
        status: subscriptionsTable.status,
        startedAt: subscriptionsTable.startedAt,
        endsAt: subscriptionsTable.endsAt,
        createdAt: subscriptionsTable.createdAt,
        plan: plansTable,
      })
      .from(subscriptionsTable)
      .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id));
    return res.json(subs);
  } catch (err) {
    req.log.error(err, "Failed to list subscriptions");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [sub] = await db
      .select({
        id: subscriptionsTable.id,
        userId: subscriptionsTable.userId,
        planId: subscriptionsTable.planId,
        status: subscriptionsTable.status,
        startedAt: subscriptionsTable.startedAt,
        endsAt: subscriptionsTable.endsAt,
        createdAt: subscriptionsTable.createdAt,
        plan: plansTable,
      })
      .from(subscriptionsTable)
      .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(and(eq(subscriptionsTable.userId, userId), eq(subscriptionsTable.status, "active")));

    if (!sub) return res.status(404).json({ error: "No active subscription" });
    return res.json(sub);
  } catch (err) {
    req.log.error(err, "Failed to get my subscription");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  const parsed = CreateSubscriptionBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const { userId: authUserId } = getAuth(req);
  const userId = parsed.data.userId ?? authUserId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [sub] = await db.insert(subscriptionsTable).values({
      userId,
      planId: parsed.data.planId,
      status: "active",
      startedAt: new Date(),
    }).returning();

    const [subWithPlan] = await db
      .select({
        id: subscriptionsTable.id,
        userId: subscriptionsTable.userId,
        planId: subscriptionsTable.planId,
        status: subscriptionsTable.status,
        startedAt: subscriptionsTable.startedAt,
        endsAt: subscriptionsTable.endsAt,
        createdAt: subscriptionsTable.createdAt,
        plan: plansTable,
      })
      .from(subscriptionsTable)
      .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(eq(subscriptionsTable.id, sub.id));

    return res.status(201).json(subWithPlan);
  } catch (err) {
    req.log.error(err, "Failed to create subscription");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  const params = UpdateSubscriptionParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateSubscriptionBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  try {
    const updateData: Record<string, unknown> = {};
    if (body.data.planId !== undefined) updateData.planId = body.data.planId;
    if (body.data.status !== undefined) updateData.status = body.data.status;
    if (body.data.endsAt !== undefined) updateData.endsAt = new Date(body.data.endsAt);

    const [sub] = await db.update(subscriptionsTable)
      .set(updateData)
      .where(eq(subscriptionsTable.id, params.data.id))
      .returning();
    if (!sub) return res.status(404).json({ error: "Not found" });

    const [subWithPlan] = await db
      .select({
        id: subscriptionsTable.id,
        userId: subscriptionsTable.userId,
        planId: subscriptionsTable.planId,
        status: subscriptionsTable.status,
        startedAt: subscriptionsTable.startedAt,
        endsAt: subscriptionsTable.endsAt,
        createdAt: subscriptionsTable.createdAt,
        plan: plansTable,
      })
      .from(subscriptionsTable)
      .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(eq(subscriptionsTable.id, sub.id));

    return res.json(subWithPlan);
  } catch (err) {
    req.log.error(err, "Failed to update subscription");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  const parsed = CancelSubscriptionParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  try {
    const [sub] = await db.update(subscriptionsTable)
      .set({ status: "cancelled", endsAt: new Date() })
      .where(eq(subscriptionsTable.id, parsed.data.id))
      .returning();
    if (!sub) return res.status(404).json({ error: "Not found" });

    const [subWithPlan] = await db
      .select({
        id: subscriptionsTable.id,
        userId: subscriptionsTable.userId,
        planId: subscriptionsTable.planId,
        status: subscriptionsTable.status,
        startedAt: subscriptionsTable.startedAt,
        endsAt: subscriptionsTable.endsAt,
        createdAt: subscriptionsTable.createdAt,
        plan: plansTable,
      })
      .from(subscriptionsTable)
      .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(eq(subscriptionsTable.id, sub.id));

    return res.json(subWithPlan);
  } catch (err) {
    req.log.error(err, "Failed to cancel subscription");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
