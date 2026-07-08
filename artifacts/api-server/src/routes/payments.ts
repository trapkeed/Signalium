import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, paymentsTable, paymentProvidersTable, plansTable, type Payment } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";
import { getPaymentProvider } from "../lib/payments/registry";
import { applySuccessfulPayment, applyFailedPayment, expireStalePayment } from "../lib/payments/paymentLifecycle";

const router = Router();

const PROVIDER_TYPES = ["usdt_trc20", "usdt_erc20", "usdt_bep20", "stripe", "paypal", "flutterwave"] as const;

async function syncPayments(rows: Payment[]): Promise<Payment[]> {
  return Promise.all(rows.map((p) => expireStalePayment(p)));
}

// ─── Payment Providers (admin-managed config, provider connectivity is code-driven) ──

// Public/authenticated-user view — NEVER includes `config` (wallet secrets, API
// keys, webhook secrets, etc. may live there). Only safe display fields.
router.get("/providers", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const rows = await db.select().from(paymentProvidersTable).orderBy(paymentProvidersTable.type);
    const publicRows = rows.map((row) => {
      const impl = getPaymentProvider(row.type);
      const configured = impl ? impl.isConfigured(row.config) : false;
      const limitation = impl ? impl.connectivityNote(row.config) : "No implementation registered for this provider type.";
      return {
        id: row.id,
        type: row.type,
        name: row.name,
        isActive: row.isActive,
        connectable: configured,
        limitation,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
    return res.json(publicRows);
  } catch (err) {
    req.log.error(err, "Failed to list payment providers");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Admin view — includes full `config`, used to populate the provider edit form.
router.get("/providers/admin", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(paymentProvidersTable).orderBy(paymentProvidersTable.type);
    const withConnectivity = rows.map((row) => {
      const impl = getPaymentProvider(row.type);
      const configured = impl ? impl.isConfigured(row.config) : false;
      const limitation = impl ? impl.connectivityNote(row.config) : "No implementation registered for this provider type.";
      return { ...row, connectable: configured, limitation };
    });
    return res.json(withConnectivity);
  } catch (err) {
    req.log.error(err, "Failed to list payment providers (admin)");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/providers", requireAdmin, async (req, res) => {
  const body = req.body as { type?: string; name?: string; config?: Record<string, string>; isActive?: boolean };
  if (!body.type || !body.name) return res.status(400).json({ error: "type and name required" });
  if (!(PROVIDER_TYPES as readonly string[]).includes(body.type)) {
    return res.status(400).json({ error: "Invalid provider type" });
  }

  try {
    const [provider] = await db.insert(paymentProvidersTable).values({
      type: body.type as (typeof PROVIDER_TYPES)[number],
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

router.get("/providers/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const [provider] = await db.select().from(paymentProvidersTable).where(eq(paymentProvidersTable.id, id));
    if (!provider) return res.status(404).json({ error: "Not found" });
    const impl = getPaymentProvider(provider.type);
    return res.json({
      ...provider,
      connectable: impl ? impl.isConfigured(provider.config) : false,
      limitation: impl ? impl.connectivityNote(provider.config) : "No implementation registered for this provider type.",
    });
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
    const rows = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.userId, userId))
      .orderBy(desc(paymentsTable.createdAt));
    return res.json(await syncPayments(rows));
  } catch (err) {
    req.log.error(err, "Failed to list payments");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/all", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt));
    return res.json(await syncPayments(rows));
  } catch (err) {
    req.log.error(err, "Failed to list all payments");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Create payment intent — user picks a plan + provider. Delegates all
// provider-specific work (wallet address / checkout session / order) to the
// PaymentProvider registry so this route never branches on provider name.
router.post("/intent", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body as { planId?: number; providerId?: number };
  if (!body.planId || !body.providerId) return res.status(400).json({ error: "planId and providerId required" });

  try {
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, body.planId));
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    const [providerRow] = await db.select().from(paymentProvidersTable).where(eq(paymentProvidersTable.id, body.providerId));
    if (!providerRow || !providerRow.isActive) return res.status(400).json({ error: "Payment provider not available" });

    const providerImpl = getPaymentProvider(providerRow.type);
    if (!providerImpl) return res.status(400).json({ error: "Payment provider not implemented" });
    if (!providerImpl.isConfigured(providerRow.config)) {
      return res.status(400).json({
        error: "Payment provider is not connectable",
        code: "PROVIDER_NOT_CONNECTABLE",
        detail: providerImpl.connectivityNote(providerRow.config),
      });
    }

    const reference = `SIG-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const [payment] = await db.insert(paymentsTable).values({
      userId,
      providerId: body.providerId,
      planId: body.planId,
      amount: plan.priceMonthly,
      currency: "USD",
      status: "pending",
      reference,
      metadata: { planId: body.planId, planName: plan.name, providerType: providerRow.type },
    }).returning();

    let intentResult;
    try {
      intentResult = await providerImpl.createIntent(
        { paymentId: payment.id, userId, amount: plan.priceMonthly, currency: "USD", planId: body.planId, planName: plan.name, reference },
        providerRow.config,
      );
    } catch (err) {
      await db.update(paymentsTable).set({ status: "failed", notes: (err as Error).message }).where(eq(paymentsTable.id, payment.id));
      return res.status(502).json({ error: "Failed to initialize payment with provider", detail: (err as Error).message });
    }

    const [updated] = await db.update(paymentsTable)
      .set({ ...intentResult.patch, updatedAt: new Date() })
      .where(eq(paymentsTable.id, payment.id))
      .returning();

    return res.status(201).json({
      payment: updated,
      provider: { type: providerRow.type, name: providerRow.name, instructions: intentResult.instructions },
    });
  } catch (err) {
    req.log.error(err, "Failed to create payment intent");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// User submits tx hash / proof for a USDT payment — moves PENDING -> CONFIRMING.
router.post("/:id/submit", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const body = req.body as { txHash?: string; notes?: string };
  if (!body.txHash) return res.status(400).json({ error: "txHash required" });

  try {
    const [existing] = await db.select().from(paymentsTable).where(and(eq(paymentsTable.id, id), eq(paymentsTable.userId, userId)));
    if (!existing) return res.status(404).json({ error: "Not found" });
    const synced = await expireStalePayment(existing);
    if (synced.status !== "pending") {
      return res.status(409).json({ error: `Payment is not awaiting proof (status: ${synced.status})`, code: "INVALID_PAYMENT_STATE" });
    }

    const patch: Record<string, unknown> = { status: "confirming", txHash: body.txHash, updatedAt: new Date() };
    if (body.notes) patch.notes = body.notes;

    const [payment] = await db.update(paymentsTable)
      .set(patch)
      .where(eq(paymentsTable.id, id))
      .returning();
    return res.json(payment);
  } catch (err) {
    req.log.error(err, "Failed to submit payment proof");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: record on-chain confirmation progress for a USDT payment (manual —
// this environment has no blockchain node / monitoring service). Once
// confirmations reach the required threshold the payment auto-transitions
// to CONFIRMED and the shared payment lifecycle runs (subscription
// activation + invoice + event log).
router.post("/:id/confirmations", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body as { confirmations?: number };
  if (typeof body.confirmations !== "number" || body.confirmations < 0) {
    return res.status(400).json({ error: "confirmations (non-negative number) required" });
  }

  try {
    const [existing] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.status !== "confirming") {
      return res.status(409).json({ error: `Payment is not in CONFIRMING state (status: ${existing.status})`, code: "INVALID_PAYMENT_STATE" });
    }

    const [updated] = await db.update(paymentsTable)
      .set({ confirmations: body.confirmations, updatedAt: new Date() })
      .where(eq(paymentsTable.id, id))
      .returning();

    await logAudit(actorUserId, "payment.overridden", "payment", String(id), {
      userId: existing.userId, action: "report_confirmations", confirmations: body.confirmations,
    });

    if (updated.requiredConfirmations != null && updated.confirmations >= updated.requiredConfirmations) {
      const finalPayment = await applySuccessfulPayment(updated.id);
      return res.json(finalPayment);
    }

    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to record payment confirmations");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: confirm payment and activate subscription (manual override, e.g. for USDT proofs verified out-of-band).
router.post("/:id/confirm", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [existing] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
    if (!existing) return res.status(404).json({ error: "Not found" });

    await logAudit(actorUserId, "payment.overridden", "payment", String(id), {
      userId: existing.userId, action: "confirm", amount: existing.amount, currency: existing.currency,
    });

    const payment = await applySuccessfulPayment(id);
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

  try {
    const [existing] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
    if (!existing) return res.status(404).json({ error: "Not found" });

    const payment = await applyFailedPayment(id, body.notes);

    await logAudit(actorUserId, "payment.overridden", "payment", String(id), {
      userId: existing.userId, action: "reject", notes: body.notes ?? null,
    });

    return res.json(payment);
  } catch (err) {
    req.log.error(err, "Failed to reject payment");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
