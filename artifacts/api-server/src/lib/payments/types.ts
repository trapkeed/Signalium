import type { Payment, PaymentProviderRow } from "@workspace/db";

/**
 * ─── PaymentProvider abstraction ────────────────────────────────────────────
 *
 * Every payment method (USDT per-network, Stripe, PayPal, Flutterwave)
 * implements this interface. Routes and the invoicing/event-log wiring only
 * ever talk to `PaymentProvider`, never to a concrete provider class or a
 * provider-type string comparison — new providers plug in by registering an
 * instance in `registry.ts`.
 *
 * Providers that require credentials we don't have configured MUST report
 * `isConfigured() === false` rather than silently succeeding with fake data.
 * Routes surface that as "not connectable" to admins instead of pretending
 * the provider works.
 */

export interface PaymentIntentContext {
  paymentId: number;
  userId: string;
  amount: number;
  currency: string;
  planId: number;
  planName: string;
  reference: string;
}

/** Provider-specific data merged into the payment row + returned to the client. */
export interface PaymentIntentResult {
  /** Fields to persist onto the payment row (network, walletAddress, requiredConfirmations, expiresAt, externalReference, ...). */
  patch: Record<string, unknown>;
  /** Human-facing instructions / checkout URL surfaced to the client. */
  instructions: Record<string, unknown>;
}

export interface WebhookVerificationOk {
  ok: true;
  /** Provider's own id for this event — used for the dedup unique constraint. */
  externalId: string;
  /** Normalized outcome extracted from the payload. */
  event: NormalizedWebhookEvent;
}
export interface WebhookVerificationFailed {
  ok: false;
  reason: string;
}
export type WebhookVerificationResult = WebhookVerificationOk | WebhookVerificationFailed;

export interface NormalizedWebhookEvent {
  /** Provider's reference to the payment (externalReference for card providers, txHash for USDT relays). */
  externalReference: string;
  outcome: "succeeded" | "failed" | "pending";
  amount?: number;
  currency?: string;
  raw: Record<string, unknown>;
}

export interface PaymentProvider {
  /** Registry key — must match the `payment_providers.type` / `payments.provider` DB enum value. */
  readonly type: PaymentProviderRow["type"];

  /** Whether this provider currently has the credentials/config it needs to actually process a payment. */
  isConfigured(config: Record<string, string>): boolean;

  /** If false, listed as unavailable in the client-facing provider list regardless of `isActive` in the DB. */
  connectivityNote(config: Record<string, string>): string | null;

  /** Builds the provider-specific fields for a newly created payment intent. */
  createIntent(ctx: PaymentIntentContext, config: Record<string, string>): Promise<PaymentIntentResult>;

  /** Verifies a webhook request's signature and normalizes its payload. Must reject anything that doesn't verify — never trust unsigned payloads. */
  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
    config: Record<string, string>,
  ): Promise<WebhookVerificationResult>;
}

export interface ProviderAwarePayment extends Payment {
  providerType: PaymentProviderRow["type"];
}
