/**
 * S29 — EA HTTP request signing + replay protection.
 *
 * Distinct from requestSigning.ts (which signs *tokens/artifacts this
 * server generates*, keyed by SESSION_SECRET). This signs *incoming* EA
 * requests, keyed by a per-API-key secret the terminal was provisioned
 * with, so a captured x-api-key/x-hardware-id pair alone is no longer
 * sufficient to forge or replay a request.
 *
 * Signature = hmacSHA256(secret, `${method}\n${path}\n${timestamp}\n${nonce}\n${body}`).
 */
import crypto from "crypto";

const TIMESTAMP_SKEW_MS = 5 * 60_000;
const NONCE_WINDOW_MS = TIMESTAMP_SKEW_MS; // nonces only need to be remembered as long as a timestamp could still be valid

// In-memory, single-process — same tradeoff as rateTracking.ts. A replayed
// request within the skew window on a different process instance would not
// be caught; acceptable for this single-instance deployment.
const seenNonces = new Map<string, number>();
function pruneNonces() {
  const cutoff = Date.now() - NONCE_WINDOW_MS;
  for (const [nonce, seenAt] of seenNonces) {
    if (seenAt < cutoff) seenNonces.delete(nonce);
  }
}

export function generateSigningSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

export interface VerifyEaRequestInput {
  secret: string;
  method: string;
  path: string;
  body: Buffer;
  signature?: string;
  timestamp?: string;
  nonce?: string;
}

export type VerifyEaRequestResult = { ok: true } | { ok: false; reason: string };

export function verifyEaRequestSignature(input: VerifyEaRequestInput): VerifyEaRequestResult {
  const { secret, method, path, body, signature, timestamp, nonce } = input;
  if (!signature || !timestamp || !nonce) return { ok: false, reason: "missing_signature_headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_SKEW_MS) {
    return { ok: false, reason: "timestamp_out_of_range" };
  }

  pruneNonces();
  const nonceKey = `${nonce}`;
  if (seenNonces.has(nonceKey)) return { ok: false, reason: "replayed_nonce" };

  const canonical = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${body.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(canonical).digest("hex");
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: "signature_mismatch" };
  }

  // Only remember the nonce once the signature is confirmed valid — an
  // attacker spamming garbage nonces shouldn't be able to exhaust memory or
  // pollute the window with unverified entries.
  seenNonces.set(nonceKey, Date.now());
  return { ok: true };
}
