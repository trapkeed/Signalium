import { Router } from "express";
import crypto from "crypto";
import { db, paymentsTable, webhookEventsTable, type PaymentProviderRow } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getPaymentProvider } from "../lib/payments/registry";
import { applySuccessfulPayment, applyFailedPayment } from "../lib/payments/paymentLifecycle";

/**
 * Per-provider webhook endpoints. Every request goes through the same
 * pipeline regardless of provider:
 *   1. verify signature (provider-specific — rejects anything unsigned/forged)
 *   2. dedup on (provider, externalId) via the webhook_events unique
 *      constraint — a retried/replayed delivery is recorded but not
 *      reprocessed
 *   3. locate the payment by the provider's externalReference and apply the
 *      normalized outcome through the shared payment lifecycle
 *
 * Mounted with its own raw-body-aware route so signature verification uses
 * the exact bytes the provider signed (see app.ts's `verify` callback on
 * express.json()).
 */

const router = Router();

async function handleWebhook(providerType: PaymentProviderRow["type"], headers: Record<string, string | string[] | undefined>, rawBody: Buffer) {
  const provider = getPaymentProvider(providerType);
  if (!provider) return { status: 404 as const, body: { error: "Unknown provider" } };

  const verification = await provider.verifyWebhook(headers, rawBody, {});
  if (!verification.ok) {
    return { status: 400 as const, body: { error: verification.reason } };
  }

  const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");

  let dedupInserted = true;
  try {
    await db.insert(webhookEventsTable).values({
      provider: providerType,
      externalId: verification.externalId,
      payloadHash,
      status: "received",
    });
  } catch {
    // Unique constraint violation on (provider, externalId) — already seen this event.
    dedupInserted = false;
  }

  if (!dedupInserted) {
    return { status: 200 as const, body: { deduped: true } };
  }

  try {
    const { event } = verification;
    if (!event.externalReference) {
      await db.update(webhookEventsTable).set({ status: "ignored", processedAt: new Date() })
        .where(eq(webhookEventsTable.externalId, verification.externalId));
      return { status: 200 as const, body: { ignored: true } };
    }

    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.externalReference, event.externalReference));
    if (!payment) {
      await db.update(webhookEventsTable).set({ status: "ignored", processedAt: new Date() })
        .where(eq(webhookEventsTable.externalId, verification.externalId));
      return { status: 200 as const, body: { ignored: true, reason: "No matching payment" } };
    }

    if (event.outcome === "succeeded") {
      await applySuccessfulPayment(payment.id);
    } else if (event.outcome === "failed") {
      await applyFailedPayment(payment.id, "Provider webhook reported failure");
    }

    await db.update(webhookEventsTable).set({ status: "processed", processedAt: new Date() })
      .where(eq(webhookEventsTable.externalId, verification.externalId));

    return { status: 200 as const, body: { ok: true } };
  } catch (err) {
    await db.update(webhookEventsTable).set({ status: "failed", error: (err as Error).message, processedAt: new Date() })
      .where(eq(webhookEventsTable.externalId, verification.externalId));
    throw err;
  }
}

function registerWebhookRoute(path: string, providerType: PaymentProviderRow["type"]) {
  router.post(path, async (req, res) => {
    try {
      const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      const result = await handleWebhook(providerType, req.headers as Record<string, string | string[] | undefined>, rawBody);
      return res.status(result.status).json(result.body);
    } catch (err) {
      req.log.error(err, `Failed to process ${providerType} webhook`);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
}

registerWebhookRoute("/stripe", "stripe");
registerWebhookRoute("/paypal", "paypal");
registerWebhookRoute("/flutterwave", "flutterwave");

export default router;
