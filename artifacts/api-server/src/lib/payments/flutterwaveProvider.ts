import crypto from "crypto";
import type { PaymentProvider, PaymentIntentContext, PaymentIntentResult, WebhookVerificationResult } from "./types";

/**
 * Flutterwave provider using the plain REST v3 API.
 *
 * LIMITATION (explicitly flagged per task scope): Replit has no first-party
 * Flutterwave connector/integration, so this provider only works if an
 * admin supplies `FLUTTERWAVE_SECRET_KEY` and `FLUTTERWAVE_WEBHOOK_HASH` as
 * plain environment secrets. Until then `isConfigured()` is false and it is
 * surfaced to admins as not connectable — no fake payment links or webhook
 * data are produced.
 */

const FLW_API_BASE = "https://api.flutterwave.com/v3";

export const flutterwaveProvider: PaymentProvider = {
  type: "flutterwave",

  isConfigured() {
    return !!process.env.FLUTTERWAVE_SECRET_KEY && !!process.env.FLUTTERWAVE_WEBHOOK_HASH;
  },

  connectivityNote() {
    if (!this.isConfigured({})) {
      return "Flutterwave has no Replit connector; an admin must supply FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_WEBHOOK_HASH as secrets before this provider can accept payments.";
    }
    return null;
  },

  async createIntent(ctx: PaymentIntentContext): Promise<PaymentIntentResult> {
    if (!this.isConfigured({})) {
      throw new Error("Flutterwave is not configured (missing FLUTTERWAVE_SECRET_KEY / FLUTTERWAVE_WEBHOOK_HASH).");
    }
    const res = await fetch(`${FLW_API_BASE}/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: ctx.reference,
        amount: ctx.amount.toFixed(2),
        currency: ctx.currency,
        redirect_url: `${process.env.PUBLIC_APP_URL ?? ""}/billing?checkout=return`,
        customer: { email: undefined },
        meta: { paymentId: ctx.paymentId, userId: ctx.userId, planId: ctx.planId },
        customizations: { title: "Signalium", description: ctx.planName },
      }),
    });
    if (!res.ok) throw new Error(`Flutterwave payment link creation failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { data: { link: string } };

    return {
      patch: { externalReference: ctx.reference, status: "confirming" },
      instructions: { paymentLink: data.data.link, txRef: ctx.reference },
    };
  },

  async verifyWebhook(headers, rawBody): Promise<WebhookVerificationResult> {
    if (!this.isConfigured({})) {
      return { ok: false, reason: "Flutterwave is not configured." };
    }
    const signature = headers["verif-hash"];
    if (!signature || Array.isArray(signature) || signature !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
      return { ok: false, reason: "Missing or invalid verif-hash header." };
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return { ok: false, reason: "Invalid JSON payload." };
    }

    const data = (body.data ?? {}) as Record<string, unknown>;
    const txId = data.id ?? crypto.createHash("sha256").update(rawBody).digest("hex");
    const status = data.status as string | undefined;
    const txRef = data.tx_ref as string | undefined;

    const outcome: "succeeded" | "failed" | "pending" =
      status === "successful" ? "succeeded" : status === "failed" ? "failed" : "pending";

    return {
      ok: true,
      externalId: String(txId),
      event: {
        externalReference: txRef ?? "",
        outcome,
        amount: typeof data.amount === "number" ? data.amount : undefined,
        currency: typeof data.currency === "string" ? data.currency : undefined,
        raw: body,
      },
    };
  },
};
