import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, subscriptionsTable, plansTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateSubscriptionBody,
  UpdateSubscriptionBody,
  UpdateSubscriptionParams,
  CancelSubscriptionParams,
  ExtendSubscriptionBody,
  GrantSubscriptionCreditBody,
} from "@workspace/api-zod";
import { requireAdmin, isAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";
import {
  resolveCurrentSubscription,
  logSubscriptionEvent,
  listSubscriptionEvents,
  getEntitlementSummary,
} from "../lib/entitlementEngine";

const router = Router();

const DEFAULT_BILLING_PERIOD_DAYS = 30;

function subscriptionWithPlanQuery() {
  return db
    .select({
      id: subscriptionsTable.id,
      userId: subscriptionsTable.userId,
      planId: subscriptionsTable.planId,
      status: subscriptionsTable.status,
      startedAt: subscriptionsTable.startedAt,
      currentPeriodEnd: subscriptionsTable.currentPeriodEnd,
      graceEndsAt: subscriptionsTable.graceEndsAt,
      cancelAtPeriodEnd: subscriptionsTable.cancelAtPeriodEnd,
      pausedAt: subscriptionsTable.pausedAt,
      cancelledAt: subscriptionsTable.cancelledAt,
      endsAt: subscriptionsTable.endsAt,
      createdAt: subscriptionsTable.createdAt,
      plan: plansTable,
    })
    .from(subscriptionsTable)
    .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id));
}

router.get("/", requireAdmin, async (req, res) => {
  try {
    const subs = await subscriptionWithPlanQuery();
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
    // Bring the user's subscription lifecycle up to date (grace/expiry
    // transitions) before returning it, then re-select with the plan join.
    const snapshot = await resolveCurrentSubscription(userId);
    if (!snapshot || snapshot.subscription.status === "cancelled") {
      return res.status(404).json({ error: "No active subscription" });
    }

    const [sub] = await subscriptionWithPlanQuery().where(eq(subscriptionsTable.id, snapshot.subscription.id));
    return res.json(sub);
  } catch (err) {
    req.log.error(err, "Failed to get my subscription");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Full entitlement summary (access flags) for the current user — used by billing/account UI.
router.get("/me/entitlements", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const summary = await getEntitlementSummary(userId);
    return res.json(summary);
  } catch (err) {
    req.log.error(err, "Failed to get entitlement summary");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  const parsed = CreateSubscriptionBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const { userId: authUserId } = getAuth(req);
  if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

  const requestedUserId = parsed.data.userId ?? authUserId;
  const actorIsAdmin = await isAdmin(authUserId);
  if (requestedUserId !== authUserId && !actorIsAdmin) {
    return res.status(403).json({ error: "Only an admin may create a subscription for another user" });
  }
  const userId = requestedUserId;

  try {
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, parsed.data.planId));
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    // Self-service creation without going through admin cannot activate a
    // paid plan directly — real payment collection/confirmation is handled
    // in the billing/payments work (checkout, webhooks), not here. Only a
    // free ($0) plan may be self-activated; anything else requires an admin
    // (e.g. manual billing override) until that flow lands.
    if (!actorIsAdmin && plan.priceMonthly > 0) {
      return res.status(403).json({ error: "Paid plans require checkout — self-activation is only available for free plans" });
    }

    const startedAt = new Date();
    const currentPeriodEnd = new Date(startedAt.getTime() + DEFAULT_BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const [sub] = await db.insert(subscriptionsTable).values({
      userId,
      planId: parsed.data.planId,
      status: "active",
      startedAt,
      currentPeriodEnd,
    }).returning();

    await logSubscriptionEvent(sub.id, userId, "SUBSCRIPTION_CREATED", null, "active", { planId: sub.planId });

    const [subWithPlan] = await subscriptionWithPlanQuery().where(eq(subscriptionsTable.id, sub.id));
    return res.status(201).json(subWithPlan);
  } catch (err) {
    req.log.error(err, "Failed to create subscription");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Event history for a subscription (admin, or the subscription's own owner).
router.get("/:id/events", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
    if (!sub) return res.status(404).json({ error: "Not found" });

    if (sub.userId !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const events = await listSubscriptionEvents(id);
    return res.json(events);
  } catch (err) {
    req.log.error(err, "Failed to list subscription events");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const params = UpdateSubscriptionParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateSubscriptionBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [before] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, params.data.id));
    if (!before) return res.status(404).json({ error: "Not found" });

    const updateData: Record<string, unknown> = {};
    if (body.data.planId !== undefined) updateData.planId = body.data.planId;
    if (body.data.status !== undefined) updateData.status = body.data.status;
    if (body.data.endsAt !== undefined) updateData.endsAt = new Date(body.data.endsAt);

    const [sub] = await db.update(subscriptionsTable)
      .set(updateData)
      .where(eq(subscriptionsTable.id, params.data.id))
      .returning();
    if (!sub) return res.status(404).json({ error: "Not found" });

    await logAudit(actorUserId, "subscription.overridden", "subscription", String(sub.id), {
      userId: sub.userId,
      before: { planId: before.planId, status: before.status, endsAt: before.endsAt },
      after: { planId: sub.planId, status: sub.status, endsAt: sub.endsAt },
    });
    if (body.data.status !== undefined && body.data.status !== before.status) {
      await logSubscriptionEvent(sub.id, sub.userId, "ADMIN_OVERRIDE", before.status, sub.status, {
        actorUserId,
        planId: sub.planId,
      });
    }

    const [subWithPlan] = await subscriptionWithPlanQuery().where(eq(subscriptionsTable.id, sub.id));
    return res.json(subWithPlan);
  } catch (err) {
    req.log.error(err, "Failed to update subscription");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: suspend a subscription immediately (out-of-band, independent of the renewal calendar).
router.post("/:id/suspend", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [before] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
    if (!before) return res.status(404).json({ error: "Not found" });
    if (before.status === "suspended") return res.status(409).json({ error: "Subscription is already suspended" });

    const [sub] = await db.update(subscriptionsTable)
      .set({ status: "suspended" })
      .where(eq(subscriptionsTable.id, id))
      .returning();

    await logSubscriptionEvent(sub.id, sub.userId, "SUBSCRIPTION_SUSPENDED", before.status, "suspended", { actorUserId });
    await logAudit(actorUserId, "subscription.suspended", "subscription", String(sub.id), {
      userId: sub.userId, fromStatus: before.status,
    });

    const [subWithPlan] = await subscriptionWithPlanQuery().where(eq(subscriptionsTable.id, sub.id));
    return res.json(subWithPlan);
  } catch (err) {
    req.log.error(err, "Failed to suspend subscription");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: reactivate a previously suspended subscription.
router.post("/:id/reactivate", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [before] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
    if (!before) return res.status(404).json({ error: "Not found" });
    if (before.status !== "suspended") return res.status(409).json({ error: "Subscription is not suspended" });

    const now = Date.now();
    const restoredStatus = before.currentPeriodEnd && before.currentPeriodEnd.getTime() < now ? "grace_period" : "active";

    const [sub] = await db.update(subscriptionsTable)
      .set({ status: restoredStatus })
      .where(eq(subscriptionsTable.id, id))
      .returning();

    await logSubscriptionEvent(sub.id, sub.userId, "SUBSCRIPTION_REACTIVATED", before.status, restoredStatus, { actorUserId });
    await logAudit(actorUserId, "subscription.reactivated", "subscription", String(sub.id), {
      userId: sub.userId, toStatus: restoredStatus,
    });

    const [subWithPlan] = await subscriptionWithPlanQuery().where(eq(subscriptionsTable.id, sub.id));
    return res.json(subWithPlan);
  } catch (err) {
    req.log.error(err, "Failed to reactivate subscription");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: extend the current billing period by N days (e.g. goodwill extension, dispute resolution).
router.post("/:id/extend", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const body = ExtendSubscriptionBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [before] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
    if (!before) return res.status(404).json({ error: "Not found" });

    const base = before.currentPeriodEnd && before.currentPeriodEnd.getTime() > Date.now() ? before.currentPeriodEnd : new Date();
    const currentPeriodEnd = new Date(base.getTime() + body.data.days * 24 * 60 * 60 * 1000);

    const [sub] = await db.update(subscriptionsTable)
      .set({ currentPeriodEnd, graceEndsAt: null, status: before.status === "grace_period" || before.status === "expired" ? "active" : before.status })
      .where(eq(subscriptionsTable.id, id))
      .returning();

    await logSubscriptionEvent(sub.id, sub.userId, "SUBSCRIPTION_EXTENDED", before.status, sub.status, {
      actorUserId, days: body.data.days, notes: body.data.notes ?? null, newCurrentPeriodEnd: currentPeriodEnd.toISOString(),
    });
    await logAudit(actorUserId, "subscription.extended", "subscription", String(sub.id), {
      userId: sub.userId, days: body.data.days, notes: body.data.notes ?? null,
    });

    const [subWithPlan] = await subscriptionWithPlanQuery().where(eq(subscriptionsTable.id, sub.id));
    return res.json(subWithPlan);
  } catch (err) {
    req.log.error(err, "Failed to extend subscription");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: grant promotional free days — implemented as extending currentPeriodEnd, distinguished from a plain
// extension by a dedicated event type + audit action for reporting purposes.
router.post("/:id/credit", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const body = GrantSubscriptionCreditBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [before] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
    if (!before) return res.status(404).json({ error: "Not found" });

    const base = before.currentPeriodEnd && before.currentPeriodEnd.getTime() > Date.now() ? before.currentPeriodEnd : new Date();
    const currentPeriodEnd = new Date(base.getTime() + body.data.days * 24 * 60 * 60 * 1000);

    const [sub] = await db.update(subscriptionsTable)
      .set({ currentPeriodEnd, graceEndsAt: null, status: before.status === "grace_period" || before.status === "expired" ? "active" : before.status })
      .where(eq(subscriptionsTable.id, id))
      .returning();

    await logSubscriptionEvent(sub.id, sub.userId, "PROMOTIONAL_CREDIT_GRANTED", before.status, sub.status, {
      actorUserId, days: body.data.days, reason: body.data.reason ?? null, newCurrentPeriodEnd: currentPeriodEnd.toISOString(),
    });
    await logAudit(actorUserId, "subscription.credit_granted", "subscription", String(sub.id), {
      userId: sub.userId, days: body.data.days, reason: body.data.reason ?? null,
    });

    const [subWithPlan] = await subscriptionWithPlanQuery().where(eq(subscriptionsTable.id, sub.id));
    return res.json(subWithPlan);
  } catch (err) {
    req.log.error(err, "Failed to grant subscription credit");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  const parsed = CancelSubscriptionParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [before] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, parsed.data.id));
    if (!before) return res.status(404).json({ error: "Not found" });

    if (before.userId !== actorUserId && !(await isAdmin(actorUserId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const cancelledAt = new Date();
    const [sub] = await db.update(subscriptionsTable)
      .set({ status: "cancelled", endsAt: cancelledAt, cancelledAt })
      .where(eq(subscriptionsTable.id, parsed.data.id))
      .returning();
    if (!sub) return res.status(404).json({ error: "Not found" });

    await logSubscriptionEvent(sub.id, sub.userId, "SUBSCRIPTION_CANCELLED", before.status, "cancelled", {});

    const [subWithPlan] = await subscriptionWithPlanQuery().where(eq(subscriptionsTable.id, sub.id));
    return res.json(subWithPlan);
  } catch (err) {
    req.log.error(err, "Failed to cancel subscription");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
