import { Router } from "express";
import crypto from "crypto";
import { db, paymentsTable, webhookEventsTable, type PaymentProviderRow } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getPaymentProvider } from "../lib/payments/registry";
import { applySuccessfulPayment, applyFailedPayment } from "../lib/payments/paymentLifecycle";

/**
 * Per-provider webhook endpoints. Every request goes through the same
 * pipeline regardless of provider:
 *   1. verify signature (provider-specific — rejects anything unsigned/forged)
 *   2. dedup on (provider, externalId) via the webhook_events unique
 *      constraint — a delivery that already fully succeeded (status
 *      "processed"/"ignored") is recorded but not reprocessed. A delivery
 *      that never finished (status "received"/"failed" — e.g. the process
 *      crashed mid-handler, or a prior attempt threw) is instead *reclaimed*
 *      and retried, so a transient failure can't permanently strand a
 *      payment in an unconfirmed state.
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

  // Scope every dedup/status lookup by (provider, externalId) together — the
  // same externalId string can independently occur across different
  // providers, and scoping by externalId alone would let one provider's
  // event mutate another provider's webhook_events row.
  const eventKey = and(eq(webhookEventsTable.provider, providerType), eq(webhookEventsTable.externalId, verification.externalId));

  let claimed = true;
  try {
    await db.insert(webhookEventsTable).values({
      provider: providerType,
      externalId: verification.externalId,
      payloadHash,
      status: "received",
    });
  } catch (err) {
    // Only a Postgres unique-violation (23505) on (provider, externalId) means
    // "already seen this event" — any other error (connection drop, schema
    // issue, etc.) must propagate instead of being silently treated as a
    // successful dedup, or real failures would get swallowed as fake 200s.
    if ((err as { code?: string })?.code !== "23505") {
      throw err;
    }

    // A row already exists for this event. Atomically reclaim it for retry
    // only if a *previous attempt explicitly failed* ("failed" — the catch
    // block below always transitions to this on error, so it's a reliable
    // "safe to retry" signal). Rows still "received" are either mid-flight
    // right now (a genuinely concurrent duplicate delivery — must NOT also
    // be claimed, or both requests would apply the payment lifecycle at
    // once) or, rarely, orphaned by a hard process crash before the catch
    // block ran (requires manual/ops follow-up, not an automatic retry, to
    // avoid ever double-applying a payment). Rows already "processed"/
    // "ignored" are left untouched and short-circuit as a genuine dedup —
    // this update matches zero rows in all of those cases.
    const reclaimed = await db.update(webhookEventsTable)
      .set({ payloadHash, error: null })
      .where(and(eventKey, eq(webhookEventsTable.status, "failed")))
      .returning();
    claimed = reclaimed.length > 0;
  }

  if (!claimed) {
    return { status: 200 as const, body: { deduped: true } };
  }

  try {
    const { event } = verification;
    if (!event.externalReference) {
      await db.update(webhookEventsTable).set({ status: "ignored", processedAt: new Date() }).where(eventKey);
      return { status: 200 as const, body: { ignored: true } };
    }

    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.externalReference, event.externalReference));
    if (!payment) {
      await db.update(webhookEventsTable).set({ status: "ignored", processedAt: new Date() }).where(eventKey);
      return { status: 200 as const, body: { ignored: true, reason: "No matching payment" } };
    }

    if (event.outcome === "succeeded") {
      await applySuccessfulPayment(payment.id);
    } else if (event.outcome === "failed") {
      await applyFailedPayment(payment.id, "Provider webhook reported failure");
    }

    await db.update(webhookEventsTable).set({ status: "processed", processedAt: new Date() }).where(eventKey);

    return { status: 200 as const, body: { ok: true } };
  } catch (err) {
    await db.update(webhookEventsTable).set({ status: "failed", error: (err as Error).message, processedAt: new Date() }).where(eventKey);
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
