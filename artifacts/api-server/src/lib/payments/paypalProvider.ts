import crypto from "crypto";
import type { PaymentProvider, PaymentIntentContext, PaymentIntentResult, WebhookVerificationResult } from "./types";

/**
 * PayPal provider using the plain REST Orders + Webhooks v2 APIs (no SDK
 * dependency). Requires `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and
 * `PAYPAL_WEBHOOK_ID` (the webhook resource id created in the PayPal
 * dashboard, needed for signature verification). None of these are
 * connected in this environment yet — see the PayPal connector, currently
 * `requires_setup` — so `isConfigured()` returns false and this provider is
 * surfaced as unavailable rather than faking an order.
 */

const PAYPAL_API_BASE = process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

async function getAccessToken(config: Record<string, string> = {}): Promise<string> {
  const clientId = (config.PAYPAL_CLIENT_ID || process.env.PAYPAL_CLIENT_ID) as string;
  const clientSecret = (config.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_CLIENT_SECRET) as string;
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal OAuth token request failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export const paypalProvider: PaymentProvider = {
  type: "paypal",

  isConfigured(config: Record<string, string> = {}) {
    return (
      !!(config.PAYPAL_CLIENT_ID || process.env.PAYPAL_CLIENT_ID) &&
      !!(config.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_CLIENT_SECRET) &&
      !!(config.PAYPAL_WEBHOOK_ID || process.env.PAYPAL_WEBHOOK_ID)
    );
  },

  connectivityNote(config: Record<string, string> = {}) {
    if (!this.isConfigured(config)) {
      return "PayPal is not connected. An admin needs to set the PayPal client id/secret + webhook id in Admin → Managed Secrets (or PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID env vars) before this provider can accept payments.";
    }
    return null;
  },

  async createIntent(ctx: PaymentIntentContext, config: Record<string, string> = {}): Promise<PaymentIntentResult> {
    if (!this.isConfigured(config)) {
      throw new Error("PayPal is not configured (missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID).");
    }
    const accessToken = await getAccessToken(config);
    const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: ctx.reference,
            custom_id: String(ctx.paymentId),
            description: ctx.planName,
            amount: { currency_code: ctx.currency, value: ctx.amount.toFixed(2) },
          },
        ],
        application_context: {
          return_url: `${process.env.PUBLIC_APP_URL ?? ""}/billing?checkout=success`,
          cancel_url: `${process.env.PUBLIC_APP_URL ?? ""}/billing?checkout=cancelled`,
        },
      }),
    });
    if (!res.ok) throw new Error(`PayPal order creation failed: ${res.status} ${await res.text()}`);
    const order = (await res.json()) as { id: string; links: { rel: string; href: string }[] };
    const approveLink = order.links.find((l) => l.rel === "approve")?.href;

    return {
      patch: { externalReference: order.id, status: "confirming" },
      instructions: { orderId: order.id, approveUrl: approveLink },
    };
  },

  async verifyWebhook(headers, rawBody, config: Record<string, string> = {}): Promise<WebhookVerificationResult> {
    if (!this.isConfigured(config)) {
      return { ok: false, reason: "PayPal is not configured." };
    }
    try {
      const accessToken = await getAccessToken(config);
      const body = JSON.parse(rawBody.toString("utf8"));
      const verifyRes = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_algo: headers["paypal-auth-algo"],
          cert_url: headers["paypal-cert-url"],
          transmission_id: headers["paypal-transmission-id"],
          transmission_sig: headers["paypal-transmission-sig"],
          transmission_time: headers["paypal-transmission-time"],
          webhook_id: config.PAYPAL_WEBHOOK_ID || process.env.PAYPAL_WEBHOOK_ID,
          webhook_event: body,
        }),
      });
      if (!verifyRes.ok) return { ok: false, reason: `PayPal signature verification request failed: ${verifyRes.status}` };
      const verification = (await verifyRes.json()) as { verification_status: string };
      if (verification.verification_status !== "SUCCESS") {
        return { ok: false, reason: "PayPal reported an invalid webhook signature." };
      }

      const eventId = body.id ?? crypto.createHash("sha256").update(rawBody).digest("hex");
      const eventType = body.event_type as string;
      const resource = body.resource ?? {};
      const orderId: string | undefined = resource.supplementary_data?.related_ids?.order_id ?? resource.id;

      if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
        return {
          ok: true,
          externalId: eventId,
          event: {
            externalReference: orderId ?? "",
            outcome: "succeeded",
            amount: resource.amount ? Number(resource.amount.value) : undefined,
            currency: resource.amount?.currency_code,
            raw: body,
          },
        };
      }

      if (eventType === "CHECKOUT.ORDER.APPROVED") {
        // Orders are created with intent=CAPTURE but the redirect flow used
        // here (approveUrl) never calls the client-side SDK's actionsCapture,
        // so nothing captures the order unless we do it here. Capture now;
        // the resulting PAYMENT.CAPTURE.COMPLETED webhook (or this call's own
        // outcome) is what actually marks the payment succeeded.
        try {
          const captureAccessToken = await getAccessToken(config);
          const captureRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
            method: "POST",
            headers: { Authorization: `Bearer ${captureAccessToken}`, "Content-Type": "application/json" },
          });
          const captured = captureRes.ok && captureRes.status !== 422;
          return {
            ok: true,
            externalId: eventId,
            event: {
              externalReference: orderId ?? "",
              outcome: captured ? "succeeded" : "pending",
              amount: resource.amount ? Number(resource.amount.value) : undefined,
              currency: resource.amount?.currency_code,
              raw: body,
            },
          };
        } catch {
          return {
            ok: true,
            externalId: eventId,
            event: { externalReference: orderId ?? "", outcome: "pending", raw: body },
          };
        }
      }
      if (eventType === "PAYMENT.CAPTURE.DENIED" || eventType === "CHECKOUT.ORDER.VOIDED" || eventType === "PAYMENT.CAPTURE.DECLINED") {
        return { ok: true, externalId: eventId, event: { externalReference: orderId ?? "", outcome: "failed", raw: body } };
      }

      return { ok: true, externalId: eventId, event: { externalReference: orderId ?? "", outcome: "pending", raw: body } };
    } catch (err) {
      return { ok: false, reason: `PayPal webhook verification error: ${(err as Error).message}` };
    }
  },
};
