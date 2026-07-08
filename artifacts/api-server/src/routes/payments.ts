import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, paymentsTable, paymentProvidersTable, subscriptionsTable, plansTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import crypto from "crypto";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";
import { logSubscriptionEvent } from "../lib/entitlementEngine";

const DEFAULT_BILLING_PERIOD_DAYS = 30;

const router = Router();

// ─── Payment Providers (admin) ────────────────────────────────────────────────

router.get("/providers", async (req, res) => {
  try {
    const providers = await db.select().from(paymentProvidersTable).orderBy(paymentProvidersTable.type);
    return res.json(providers);
  } catch (err) {
    req.log.error(err, "Failed to list payment providers");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/providers", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body as { type?: string; name?: string; config?: Record<string, string>; isActive?: boolean };
  if (!body.type || !body.name) return res.status(400).json({ error: "type and name required" });

  const type = body.type as "usdt" | "card" | "bank_transfer";
  if (!["usdt", "card", "bank_transfer"].includes(type)) {
    return res.status(400).json({ error: "Invalid provider type" });
  }

  try {
    const [provider] = await db.insert(paymentProvidersTable).values({
      type,
      name: body.name,
      config: body.config ?? {},
      isActive: body.isActive ?? false,
    }).returning();
    return res.status(201).json(provider);
  } catch (err) {
    req.log.error(err, "Failed to create payment provider");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/providers/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const [provider] = await db.select().from(paymentProvidersTable).where(eq(paymentProvidersTable.id, id));
    if (!provider) return res.status(404).json({ error: "Not found" });
    return res.json(provider);
  } catch (err) {
    req.log.error(err, "Failed to get payment provider");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/providers/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const body = req.body as { name?: string; config?: Record<string, string>; isActive?: boolean };
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.config !== undefined) patch.config = body.config;
  if (body.isActive !== undefined) patch.isActive = body.isActive;

  try {
    const [provider] = await db.update(paymentProvidersTable)
      .set(patch)
      .where(eq(paymentProvidersTable.id, id))
      .returning();
    if (!provider) return res.status(404).json({ error: "Not found" });
    return res.json(provider);
  } catch (err) {
    req.log.error(err, "Failed to update payment provider");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/providers/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    await db.delete(paymentProvidersTable).where(eq(paymentProvidersTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete payment provider");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Payments (user) ──────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payments = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.userId, userId))
      .orderBy(desc(paymentsTable.createdAt));
    return res.json(payments);
  } catch (err) {
    req.log.error(err, "Failed to list payments");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/all", async (req, res) => {
  try {
    const payments = await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt));
    return res.json(payments);
  } catch (err) {
    req.log.error(err, "Failed to list all payments");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Create payment intent — user picks a plan + provider
router.post("/intent", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body as { planId?: number; providerId?: number };
  if (!body.planId || !body.providerId) return res.status(400).json({ error: "planId and providerId required" });

  try {
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, body.planId));
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    const [provider] = await db.select().from(paymentProvidersTable).where(eq(paymentProvidersTable.id, body.providerId));
    if (!provider || !provider.isActive) return res.status(400).json({ error: "Payment provider not available" });

    const reference = `SIG-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const [payment] = await db.insert(paymentsTable).values({
      userId,
      providerId: body.providerId,
      amount: plan.priceMonthly,
      currency: "USD",
      status: "pending",
      reference,
      metadata: { planId: body.planId, planName: plan.name, providerType: provider.type },
    }).returning();

    return res.status(201).json({
      payment,
      provider: { type: provider.type, name: provider.name, instructions: provider.config },
    });
  } catch (err) {
    req.log.error(err, "Failed to create payment intent");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// User submits tx hash / proof
router.post("/:id/submit", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const body = req.body as { txHash?: string; notes?: string };
  const patch: Record<string, unknown> = { status: "submitted", updatedAt: new Date() };
  if (body.txHash) patch.txHash = body.txHash;
  if (body.notes) patch.notes = body.notes;

  try {
    const [payment] = await db.update(paymentsTable)
      .set(patch)
      .where(and(eq(paymentsTable.id, id), eq(paymentsTable.userId, userId)))
      .returning();
    if (!payment) return res.status(404).json({ error: "Not found" });
    return res.json(payment);
  } catch (err) {
    req.log.error(err, "Failed to submit payment proof");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: confirm payment → activate subscription
router.post("/:id/confirm", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [payment] = await db.update(paymentsTable)
      .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(paymentsTable.id, id))
      .returning();
    if (!payment) return res.status(404).json({ error: "Not found" });

    await logAudit(actorUserId, "payment.overridden", "payment", String(payment.id), {
      userId: payment.userId,
      action: "confirm",
      amount: payment.amount,
      currency: payment.currency,
    });

    const meta = payment.metadata as Record<string, unknown>;
    const planId = typeof meta.planId === "number" ? meta.planId : null;
    if (planId) {
      // A confirmed payment counts as a successful renewal even if the
      // subscription had lapsed into GRACE_PERIOD — it brings the user back
      // to ACTIVE with a fresh billing period.
      const [existing] = await db.select().from(subscriptionsTable)
        .where(and(eq(subscriptionsTable.userId, payment.userId), inArray(subscriptionsTable.status, ["active", "grace_period"])));

      const now = new Date();
      const currentPeriodEnd = new Date(now.getTime() + DEFAULT_BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000);

      if (!existing) {
        const [sub] = await db.insert(subscriptionsTable).values({
          userId: payment.userId, planId, status: "active", startedAt: now, currentPeriodEnd,
        }).returning();
        await db.update(paymentsTable).set({ subscriptionId: sub.id }).where(eq(paymentsTable.id, id));
        await logSubscriptionEvent(sub.id, payment.userId, "SUBSCRIPTION_CREATED", null, "active", { planId, paymentId: payment.id });
      } else {
        await db.update(subscriptionsTable)
          .set({ planId, status: "active", currentPeriodEnd, graceEndsAt: null })
          .where(eq(subscriptionsTable.id, existing.id));
        await logSubscriptionEvent(existing.id, payment.userId, "SUBSCRIPTION_RENEWED", existing.status, "active", { planId, paymentId: payment.id });
      }
    }

    return res.json(payment);
  } catch (err) {
    req.log.error(err, "Failed to confirm payment");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: reject payment
router.post("/:id/reject", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body as { notes?: string };
  const patch: Record<string, unknown> = { status: "failed", updatedAt: new Date() };
  if (body.notes) patch.notes = body.notes;

  try {
    const [payment] = await db.update(paymentsTable)
      .set(patch)
      .where(eq(paymentsTable.id, id))
      .returning();
    if (!payment) return res.status(404).json({ error: "Not found" });

    await logAudit(actorUserId, "payment.overridden", "payment", String(payment.id), {
      userId: payment.userId,
      action: "reject",
      notes: body.notes ?? null,
    });

    return res.json(payment);
  } catch (err) {
    req.log.error(err, "Failed to reject payment");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
