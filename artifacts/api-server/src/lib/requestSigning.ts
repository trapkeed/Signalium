/**
 * S28 — Cryptographic request/artifact signing.
 *
 * Two uses:
 *  1. Stateless, tamper-evident confirmation tokens (e.g. "confirm account
 *     deletion") delivered by email — an HMAC over the payload + expiry
 *     means we don't need to store a lookup secret server-side beyond the
 *     payload itself (unlike the random-token+hash pattern used for account
 *     unlock, which does need a stored hash). Either pattern is valid; this
 *     one is used where the token must self-describe *what* it authorizes.
 *  2. Integrity signatures over generated compliance artifacts (data export
 *     payloads) so a downloaded export can be verified later to be exactly
 *     what the platform produced, byte for byte.
 *
 * Keyed by SESSION_SECRET (already a rotated, managed secret — see
 * secretRotation.ts) rather than introducing a new one.
 */
import crypto from "crypto";

function getSigningKey(): string {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("SESSION_SECRET is required for request/artifact signing");
  return key;
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", getSigningKey()).update(payload).digest("hex");
}

export interface SignedToken<T> {
  payload: T;
  exp: number; // epoch ms
}

/** Produces a compact, URL-safe signed token: base64url(json).hexHmac */
export function signToken<T extends Record<string, unknown>>(payload: T, ttlMs: number): string {
  const body: SignedToken<T> = { payload, exp: Date.now() + ttlMs };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${encoded}.${hmac(encoded)}`;
}

export type VerifyResult<T> =
  | { ok: true; payload: T }
  | { ok: false; reason: "malformed" | "invalid_signature" | "expired" };

/** Verifies signature and expiry (constant-time signature comparison). */
export function verifyToken<T>(token: string): VerifyResult<T> {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [encoded, signature] = parts;
  const expected = hmac(encoded);
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: "invalid_signature" };
  }
  let decoded: SignedToken<T>;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (Date.now() > decoded.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload: decoded.payload };
}

/** Signs an arbitrary artifact (e.g. a JSON export) for later integrity verification. */
export function signArtifact(canonicalJson: string): string {
  return hmac(canonicalJson);
}

export function verifyArtifact(canonicalJson: string, signature: string): boolean {
  const expected = hmac(canonicalJson);
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
}
