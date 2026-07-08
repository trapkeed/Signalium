import Stripe from "stripe";
import type { PaymentProvider, PaymentIntentContext, PaymentIntentResult, WebhookVerificationResult } from "./types";

/**
 * Stripe provider. Requires `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
 * to be present as environment secrets (see the Replit Stripe connector —
 * not yet connected in this environment, so `isConfigured()` returns false
 * and this provider is surfaced as unavailable rather than faking a
 * checkout session). Once connected, this creates a real Stripe Checkout
 * Session and verifies webhook signatures with the real Stripe SDK.
 */
export const stripeProvider: PaymentProvider = {
  type: "stripe",

  isConfigured() {
    return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
  },

  connectivityNote() {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      return "Stripe is not connected. An admin needs to connect the Stripe integration (secret key + webhook signing secret) before this provider can accept payments.";
    }
    return null;
  },

  async createIntent(ctx: PaymentIntentContext): Promise<PaymentIntentResult> {
    if (!this.isConfigured({})) {
      throw new Error("Stripe is not configured (missing STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET).");
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: ctx.currency.toLowerCase(),
            product_data: { name: ctx.planName },
            unit_amount: Math.round(ctx.amount * 100),
          },
          quantity: 1,
        },
      ],
      client_reference_id: ctx.reference,
      metadata: { paymentId: String(ctx.paymentId), userId: ctx.userId, planId: String(ctx.planId) },
      success_url: `${process.env.PUBLIC_APP_URL ?? ""}/billing?checkout=success`,
      cancel_url: `${process.env.PUBLIC_APP_URL ?? ""}/billing?checkout=cancelled`,
    });

    return {
      patch: { externalReference: session.id, status: "confirming" },
      instructions: { checkoutUrl: session.url, sessionId: session.id },
    };
  },

  async verifyWebhook(headers, rawBody): Promise<WebhookVerificationResult> {
    if (!this.isConfigured({})) {
      return { ok: false, reason: "Stripe is not configured." };
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const signature = headers["stripe-signature"];
    if (!signature || Array.isArray(signature)) {
      return { ok: false, reason: "Missing or invalid Stripe-Signature header." };
    }
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET as string);
    } catch (err) {
      return { ok: false, reason: `Stripe signature verification failed: ${(err as Error).message}` };
    }

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        ok: true,
        externalId: event.id,
        event: {
          externalReference: session.id,
          outcome: session.payment_status === "paid" ? "succeeded" : "pending",
          amount: session.amount_total ? session.amount_total / 100 : undefined,
          currency: session.currency?.toUpperCase(),
          raw: event as unknown as Record<string, unknown>,
        },
      };
    }
    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        ok: true,
        externalId: event.id,
        event: { externalReference: session.id, outcome: "failed", raw: event as unknown as Record<string, unknown> },
      };
    }

    return {
      ok: true,
      externalId: event.id,
      event: { externalReference: "", outcome: "pending", raw: event as unknown as Record<string, unknown> },
    };
  },
};
