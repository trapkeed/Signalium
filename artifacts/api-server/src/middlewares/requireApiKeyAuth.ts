import type { NextFunction, Request, Response } from "express";
import { db, apiKeysTable, eaRegistrationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { emitSecurityIncident } from "../lib/securityIncidents";
import { recordEaRequestAndCheckExcessive, recordApiRequestAndCheckAbuse, recordFailedAuthAndCheckBruteForce } from "../lib/rateTracking";
import { verifyEaRequestSignature } from "../lib/eaRequestSigning";

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export interface ApiKeyAuthContext {
  userId: string;
  apiKeyId: number;
  eaRegistrationId: number;
}

export type ApiKeyAuthErrorCode = "INVALID_API_KEY" | "API_KEY_EXPIRED" | "API_KEY_SUSPENDED" | "API_KEY_REVOKED" | "EA_NOT_REGISTERED";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      eaAuth?: ApiKeyAuthContext;
    }
  }
}

/**
 * Resolves a raw API key + hardwareId pair (as sent by an EA terminal, never
 * a Clerk session) to the owning user, key, and registered terminal. Used to
 * authenticate the EA <-> Platform telemetry/action loop (WebSocket and HTTP
 * fallback routes both funnel through this).
 */
export async function resolveApiKeyAuth(rawApiKey: string, hardwareId: string, ipAddress?: string): Promise<ApiKeyAuthContext | { error: string; code: ApiKeyAuthErrorCode; status: number }> {
  const keyHash = hashApiKey(rawApiKey);
  const [key] = await db.select().from(apiKeysTable).where(eq(apiKeysTable.keyHash, keyHash));
  if (!key) {
    // Repeated invalid-key attempts from the same IP look like a brute-force
    // attempt against the EA auth surface (there's no Clerk password to
    // brute-force here, so this is our closest analogue).
    if (ipAddress && recordFailedAuthAndCheckBruteForce(ipAddress)) {
      void emitSecurityIncident({
        type: "brute_force_auth",
        severity: "high",
        message: `Repeated invalid API key attempts from ${ipAddress}`,
        ipAddress,
      });
    }
    return { error: "Invalid API key", code: "INVALID_API_KEY", status: 401 };
  }

  if (key.status === "active" && key.expiresAt && key.expiresAt.getTime() < Date.now()) {
    await db.update(apiKeysTable).set({ status: "expired" }).where(eq(apiKeysTable.id, key.id));
    return { error: "API key is expired", code: "API_KEY_EXPIRED", status: 401 };
  }
  if (key.status !== "active") {
    const code: ApiKeyAuthErrorCode = key.status === "suspended" ? "API_KEY_SUSPENDED" : key.status === "revoked" ? "API_KEY_REVOKED" : "API_KEY_EXPIRED";
    return { error: `API key is ${key.status}`, code, status: 401 };
  }

  const [registration] = await db.select().from(eaRegistrationsTable)
    .where(and(eq(eaRegistrationsTable.apiKeyId, key.id), eq(eaRegistrationsTable.hardwareId, hardwareId)));
  if (!registration || !registration.isActive) {
    return { error: "EA terminal is not registered or has been deactivated", code: "EA_NOT_REGISTERED", status: 401 };
  }

  await db.update(apiKeysTable).set({ lastUsedAt: new Date() }).where(eq(apiKeysTable.id, key.id));
  await db.update(eaRegistrationsTable).set({ lastSeenAt: new Date() }).where(eq(eaRegistrationsTable.id, registration.id));

  if (recordEaRequestAndCheckExcessive(key.id)) {
    void emitSecurityIncident({
      type: "excessive_ea_requests",
      severity: "medium",
      message: `API key ${key.id} exceeded the expected EA request rate`,
      userId: key.userId,
      apiKeyId: key.id,
      detail: { hardwareId },
    });
  }
  if (ipAddress && recordApiRequestAndCheckAbuse(ipAddress)) {
    void emitSecurityIncident({
      type: "api_abuse",
      severity: "medium",
      message: `Unusually high request volume from ${ipAddress}`,
      ipAddress,
      userId: key.userId,
    });
  }

  return { userId: key.userId, apiKeyId: key.id, eaRegistrationId: registration.id };
}

/**
 * Express middleware wrapper around resolveApiKeyAuth for HTTP routes
 * (x-api-key / x-hardware-id headers).
 *
 * S29 — also enforces request signing + replay protection when the caller
 * has a `signingSecret` provisioned (see eaRequestSigning.ts): `x-signature`
 * (HMAC-SHA256 over method+path+timestamp+nonce+body), `x-timestamp`
 * (rejects if outside a 5-minute skew window), and `x-nonce` (rejected if
 * seen before within that window). Legacy keys without a signing secret
 * fall back to key+hardwareId-only auth so existing EA installs aren't
 * broken by this rollout — new keys are provisioned with a secret by
 * default (see api-keys.ts).
 */
export async function requireApiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const rawApiKey = req.headers["x-api-key"] as string | undefined;
  const hardwareId = req.headers["x-hardware-id"] as string | undefined;
  if (!rawApiKey || !hardwareId) {
    return res.status(401).json({ error: "x-api-key and x-hardware-id headers are required", code: "INVALID_API_KEY" });
  }

  const result = await resolveApiKeyAuth(rawApiKey, hardwareId, req.ip);
  if ("error" in result) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }

  const [key] = await db.select({ signingSecret: apiKeysTable.signingSecret }).from(apiKeysTable).where(eq(apiKeysTable.id, result.apiKeyId));
  if (key?.signingSecret) {
    const signature = req.headers["x-signature"] as string | undefined;
    const timestamp = req.headers["x-timestamp"] as string | undefined;
    const nonce = req.headers["x-nonce"] as string | undefined;
    const verification = verifyEaRequestSignature({
      secret: key.signingSecret,
      method: req.method,
      path: req.path,
      body: req.rawBody ?? Buffer.alloc(0),
      signature, timestamp, nonce,
    });
    if (!verification.ok) {
      void emitSecurityIncident({
        type: "invalid_request_signature",
        severity: "high",
        message: `EA request signature check failed for API key ${result.apiKeyId}: ${verification.reason}`,
        userId: result.userId,
        apiKeyId: result.apiKeyId,
        ipAddress: req.ip,
        scopeKey: verification.reason,
      });
      return res.status(401).json({ error: `Invalid request signature: ${verification.reason}`, code: "INVALID_SIGNATURE" });
    }
  }

  req.eaAuth = result;
  return next();
}
