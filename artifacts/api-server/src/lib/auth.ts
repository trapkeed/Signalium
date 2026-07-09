/**
 * Self-hosted authentication — replaces Clerk.
 *
 * Sessions are opaque server-side tokens (not JWTs) stored hashed in
 * `auth_sessions`, carried via an httpOnly cookie. `sessionAuthMiddleware`
 * (mounted in app.ts, same slot Clerk's `clerkMiddleware` used to occupy)
 * resolves the cookie once per request and attaches `req.auth`; `getAuth(req)`
 * is a synchronous drop-in for `@clerk/express`'s `getAuth`, returning the
 * same `{ userId, sessionId }` shape so every existing call site
 * (requireAdmin.ts, sso.ts, ~40 routes) keeps working unchanged.
 */
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { promisify } from "node:util";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string | null; sessionId: string | null };
    }
  }
}

export const SESSION_COOKIE_NAME = "sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const scrypt = promisify(crypto.scrypt);

// ─── Password hashing (scrypt, no extra dependency needed) ────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const storedBuf = Buffer.from(hashHex, "hex");
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

// ─── One-time email codes (signup/login verification) ─────────────────────

export function generateNumericCode(): string {
  // 6-digit code, zero-padded — easy to type from an email on a phone.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// ─── Sessions ───────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, ip?: string, userAgent?: string): Promise<{ token: string; sessionId: string }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const sessionId = crypto.randomUUID();
  await db.insert(sessionsTable).values({
    id: sessionId,
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ipAddress: ip,
    userAgent,
  });
  return { token, sessionId };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.update(sessionsTable).set({ revokedAt: new Date() }).where(eq(sessionsTable.id, sessionId));
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

/**
 * Resolves the current request's session from its cookie and attaches
 * `req.auth`. Mounted globally (like Clerk's middleware was) so `getAuth`
 * can stay synchronous everywhere downstream. Invalid/expired/revoked
 * sessions resolve to `{ userId: null, sessionId: null }` rather than
 * erroring — routes decide what (if anything) requires auth.
 */
export async function sessionAuthMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (!token) {
    req.auth = { userId: null, sessionId: null };
    return next();
  }

  try {
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.tokenHash, hashToken(token)));
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      req.auth = { userId: null, sessionId: null };
      return next();
    }
    req.auth = { userId: session.userId, sessionId: session.id };
    // Best-effort activity touch — never blocks the request on failure.
    void db.update(sessionsTable).set({ lastSeenAt: new Date() }).where(eq(sessionsTable.id, session.id)).catch(() => {});
    return next();
  } catch (err) {
    req.log?.error(err, "Session auth lookup failed");
    req.auth = { userId: null, sessionId: null };
    return next();
  }
}

/** Drop-in replacement for `@clerk/express`'s `getAuth(req)`. */
export function getAuth(req: Request): { userId: string | null; sessionId: string | null } {
  return req.auth ?? { userId: null, sessionId: null };
}
