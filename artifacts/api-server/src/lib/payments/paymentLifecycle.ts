import { db, paymentsTable, subscriptionsTable, plansTable, type Payment } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logSubscriptionEvent } from "../entitlementEngine";
import { createInvoice } from "./invoices";
import { logger } from "../logger";

const DEFAULT_BILLING_PERIOD_DAYS = 30;

interface PaymentMetadata {
  planId?: number;
  planName?: string;
  providerType?: string;
}

/**
 * Applies a CONFIRMED payment: activates/renews the subscription, records
 * the lifecycle event on the Task #23 event log, and auto-generates an
 * invoice. Idempotent — if the payment is already terminal (confirmed or
 * beyond) this is a no-op, so webhook retries / duplicate admin actions
 * can't double-activate a subscription or double-invoice.
 *
 * Everything below runs inside a single DB transaction: the payment-status
 * flip, subscription upsert, event-log rows, and invoice insert either all
 * commit together or none do. That's what makes the leading status guard a
 * valid dedup check — a prior call either fully succeeded (guard catches
 * the retry) or fully rolled back (nothing was persisted, so this call
 * starts clean) — there is no partially-applied state to reconcile.
 */
export async function applySuccessfulPayment(paymentId: number): Promise<Payment | null> {
  const [existingPayment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
  if (!existingPayment) return null;
  if (existingPayment.status === "confirmed" || existingPayment.status === "refunded") return existingPayment;

  return db.transaction(async (tx) => {
    const [confirmed] = await tx.update(paymentsTable)
      .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(paymentsTable.id, paymentId))
      .returning();

    const meta = confirmed.metadata as PaymentMetadata;
    const planId = meta.planId ?? confirmed.planId ?? null;
    if (!planId) {
      logger.warn({ paymentId }, "Confirmed payment has no associated planId; skipping subscription activation");
      return confirmed;
    }

    const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, planId));
    if (!plan) {
      logger.error({ paymentId, planId }, "Confirmed payment references a plan that no longer exists");
      return confirmed;
    }

    const now = new Date();
    const currentPeriodEnd = new Date(now.getTime() + DEFAULT_BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const [existing] = await tx.select().from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.userId, confirmed.userId), inArray(subscriptionsTable.status, ["active", "grace_period", "pending_payment"])));

    let subscriptionId: number;
    let reason: "subscription_created" | "subscription_renewed" | "subscription_upgraded" | "subscription_downgraded";

    if (!existing) {
      const [sub] = await tx.insert(subscriptionsTable).values({
        userId: confirmed.userId, planId, status: "active", startedAt: now, currentPeriodEnd,
      }).returning();
      subscriptionId = sub.id;
      reason = "subscription_created";
      await logSubscriptionEvent(sub.id, confirmed.userId, "SUBSCRIPTION_CREATED", null, "active", { planId, paymentId: confirmed.id }, tx);
    } else {
      const isPlanChange = existing.planId !== planId;
      subscriptionId = existing.id;
      await tx.update(subscriptionsTable)
        .set({ planId, status: "active", currentPeriodEnd, graceEndsAt: null })
        .where(eq(subscriptionsTable.id, existing.id));

      if (isPlanChange) {
        const [oldPlan] = await tx.select().from(plansTable).where(eq(plansTable.id, existing.planId));
        const isUpgrade = oldPlan ? plan.priceMonthly > oldPlan.priceMonthly : true;
        reason = isUpgrade ? "subscription_upgraded" : "subscription_downgraded";
        await logSubscriptionEvent(
          existing.id, confirmed.userId,
          isUpgrade ? "SUBSCRIPTION_UPGRADED" : "SUBSCRIPTION_DOWNGRADED",
          existing.status, "active", { planId, previousPlanId: existing.planId, paymentId: confirmed.id }, tx,
        );
      } else {
        reason = "subscription_renewed";
        await logSubscriptionEvent(existing.id, confirmed.userId, "SUBSCRIPTION_RENEWED", existing.status, "active", { planId, paymentId: confirmed.id }, tx);
      }
    }

    await tx.update(paymentsTable).set({ subscriptionId }).where(eq(paymentsTable.id, paymentId));
    await logSubscriptionEvent(subscriptionId, confirmed.userId, "PAYMENT_CONFIRMED", null, null, {
      paymentId: confirmed.id, amount: confirmed.amount, currency: confirmed.currency, providerId: confirmed.providerId,
    }, tx);

    const invoice = await createInvoice({
      userId: confirmed.userId,
      subscriptionId,
      paymentId: confirmed.id,
      planId,
      provider: (meta.providerType as import("@workspace/db").PaymentProviderRow["type"]) ?? null,
      paymentReference: confirmed.reference ?? confirmed.txHash ?? confirmed.externalReference ?? null,
      currency: confirmed.currency,
      reason,
      items: [{ description: `${plan.name} subscription — ${reason.replace("subscription_", "")}`, unitAmount: confirmed.amount }],
    }, tx);
    await logSubscriptionEvent(subscriptionId, confirmed.userId, "INVOICE_ISSUED", null, null, {
      invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
    }, tx);

    const [final] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
    return final;
  });
}

/** Applies a FAILED payment: marks it failed and logs the event if it's tied to a subscription attempt. */
export async function applyFailedPayment(paymentId: number, notes?: string): Promise<Payment | null> {
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
  if (!payment) return null;
  if (payment.status === "confirmed" || payment.status === "failed" || payment.status === "refunded") return payment;

  const [failed] = await db.update(paymentsTable)
    .set({ status: "failed", notes: notes ?? payment.notes, updatedAt: new Date() })
    .where(eq(paymentsTable.id, paymentId))
    .returning();

  if (failed.subscriptionId) {
    await logSubscriptionEvent(failed.subscriptionId, failed.userId, "PAYMENT_FAILED", null, null, {
      paymentId: failed.id, notes: notes ?? null,
    });
  }
  return failed;
}

/**
 * Lazily expires PENDING/CONFIRMING payments whose intent window has
 * elapsed — mirrors the lazy lifecycle-sync pattern used for subscriptions
 * (see entitlementEngine.syncLifecycle) rather than requiring a cron job.
 */
export async function expireStalePayment(payment: Payment): Promise<Payment> {
  if ((payment.status === "pending" || payment.status === "confirming") && payment.expiresAt && payment.expiresAt.getTime() < Date.now()) {
    const [expired] = await db.update(paymentsTable)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(paymentsTable.id, payment.id))
      .returning();
    return expired;
  }
  return payment;
}
