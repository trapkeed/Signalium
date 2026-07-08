import type { NextFunction, Request, Response } from "express";
import { db, apiKeysTable, eaRegistrationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export interface ApiKeyAuthContext {
  userId: string;
  apiKeyId: number;
  eaRegistrationId: number;
}

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
export async function resolveApiKeyAuth(rawApiKey: string, hardwareId: string): Promise<ApiKeyAuthContext | { error: string; status: number }> {
  const keyHash = hashApiKey(rawApiKey);
  const [key] = await db.select().from(apiKeysTable).where(eq(apiKeysTable.keyHash, keyHash));
  if (!key) return { error: "Invalid API key", status: 401 };

  if (key.status === "active" && key.expiresAt && key.expiresAt.getTime() < Date.now()) {
    await db.update(apiKeysTable).set({ status: "expired" }).where(eq(apiKeysTable.id, key.id));
    return { error: "API key is expired", status: 401 };
  }
  if (key.status !== "active") {
    return { error: `API key is ${key.status}`, status: 401 };
  }

  const [registration] = await db.select().from(eaRegistrationsTable)
    .where(and(eq(eaRegistrationsTable.apiKeyId, key.id), eq(eaRegistrationsTable.hardwareId, hardwareId)));
  if (!registration || !registration.isActive) {
    return { error: "EA terminal is not registered or has been deactivated", status: 401 };
  }

  await db.update(apiKeysTable).set({ lastUsedAt: new Date() }).where(eq(apiKeysTable.id, key.id));
  await db.update(eaRegistrationsTable).set({ lastSeenAt: new Date() }).where(eq(eaRegistrationsTable.id, registration.id));

  return { userId: key.userId, apiKeyId: key.id, eaRegistrationId: registration.id };
}

/** Express middleware wrapper around resolveApiKeyAuth for HTTP routes (x-api-key / x-hardware-id headers). */
export async function requireApiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const rawApiKey = req.headers["x-api-key"] as string | undefined;
  const hardwareId = req.headers["x-hardware-id"] as string | undefined;
  if (!rawApiKey || !hardwareId) {
    return res.status(401).json({ error: "x-api-key and x-hardware-id headers are required" });
  }

  const result = await resolveApiKeyAuth(rawApiKey, hardwareId);
  if ("error" in result) {
    return res.status(result.status).json({ error: result.error });
  }

  req.eaAuth = result;
  return next();
}
