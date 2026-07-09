/**
 * S24C — SSO Identity Provider.
 *
 * Signalium is the single authentication authority for the ecosystem
 * (platform, Signalium Trainer / Research Lab, future internal services).
 * This module issues short-lived signed access tokens (JWT, ES256) plus
 * opaque refresh tokens, and exposes what verifiers need to validate a
 * token — a public JWKS — without ever sharing a password or symmetric
 * secret with a downstream service.
 *
 * Signing key: generated once (P-256 keypair) and persisted in
 * `sso_signing_keys` so it survives restarts; rotation inserts a new active
 * key while keeping old keys available for verification by `kid` so
 * already-issued tokens don't break mid-rotation.
 */
import { randomUUID, randomBytes, createHash, generateKeyPair as generateKeyPairNode } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, importJWK, exportJWK, jwtVerify, type JWK } from "jose";
import { db, ssoSigningKeysTable, ssoRefreshTokensTable } from "@workspace/db";
import { and, eq, isNull, gt, desc } from "drizzle-orm";
import { logAudit } from "./auditLog";
import type { AdminRoleName } from "./roles";
import { logger } from "./logger";
import { resolveManagedConfig } from "./secretsVault";

const generateKeyPair = promisify(generateKeyPairNode);

// Defaults — overridable per-deployment via the managed secrets vault
// (`sso.issuer`, `sso.access_token_ttl_seconds`, `sso.refresh_token_ttl_days`)
// with env-var fallback (JWT_ISSUER, JWT_EXPIRATION, JWT_REFRESH_EXPIRATION),
// so rotating these doesn't require a redeploy. Resolved lazily rather than
// once at import time so an admin change takes effect on next issuance
// without a restart.
const DEFAULT_ISSUER = "signalium";
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 5 * 60; // 5 minutes — short-lived by design
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 30;

export async function getSsoIssuer(): Promise<string> {
  const v = await resolveManagedConfig("sso.issuer", "JWT_ISSUER");
  return v && v.trim() ? v.trim() : DEFAULT_ISSUER;
}

export async function getAccessTokenTtlSeconds(): Promise<number> {
  const v = await resolveManagedConfig("sso.access_token_ttl_seconds", "JWT_EXPIRATION");
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
}

export async function getRefreshTokenTtlMs(): Promise<number> {
  const v = await resolveManagedConfig("sso.refresh_token_ttl_days", "JWT_REFRESH_EXPIRATION");
  const days = v ? Number(v) : NaN;
  const resolvedDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_REFRESH_TOKEN_TTL_DAYS;
  return resolvedDays * 24 * 60 * 60 * 1000;
}

/** @deprecated kept for any external references — prefer `getSsoIssuer()` for the resolved, admin-configurable value. */
export const SSO_ISSUER = DEFAULT_ISSUER;
const SERVICE_TOKEN_AUDIENCE = "signalium-trainer";
export type SsoAudience = "signalium-trainer" | "signalium-platform";

export interface SsoTokenClaims {
  sub: string;
  email?: string;
  /** Admin roles held by a human caller. Empty for machine/service tokens — see `scope` instead. */
  roles: AdminRoleName[];
  /** Least-privilege scope strings for machine-to-machine service tokens (e.g. `trainer.inference`). Never used to grant admin-role-equivalent access. */
  scope?: string[];
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

let activeKeyCache: { kid: string; privateKey: CryptoKey } | null = null;

async function ensureActiveKey(): Promise<{ kid: string; privateKey: CryptoKey }> {
  if (activeKeyCache) return activeKeyCache;

  const [existing] = await db.select().from(ssoSigningKeysTable).where(eq(ssoSigningKeysTable.isActive, "true")).limit(1);
  if (existing) {
    const jwk = JSON.parse(existing.privateKeyPem) as JWK;
    const privateKey = (await importJWK(jwk, "ES256")) as CryptoKey;
    activeKeyCache = { kid: existing.kid, privateKey };
    return activeKeyCache;
  }

  // First boot: no signing key exists yet — generate one and persist it.
  const { publicKey, privateKey } = await generateKeyPair("ec", { namedCurve: "P-256" });
  const kid = randomUUID();
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  publicJwk.kid = kid;
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";

  await db.insert(ssoSigningKeysTable).values({
    kid,
    privateKeyPem: JSON.stringify({ ...privateJwk, kid }),
    publicKeyJwk: JSON.stringify(publicJwk),
    isActive: "true",
  });
  logger.info({ kid }, "SSO: generated new signing key (first boot)");

  const importedPrivateKey = (await importJWK({ ...privateJwk, kid }, "ES256")) as CryptoKey;
  activeKeyCache = { kid, privateKey: importedPrivateKey };
  return activeKeyCache;
}

/** Rotates the active signing key, keeping the previous key verifiable. SuperAdmin-only at the route layer. */
export async function rotateSigningKey(actorUserId: string): Promise<{ kid: string }> {
  await db.update(ssoSigningKeysTable).set({ isActive: "false" }).where(eq(ssoSigningKeysTable.isActive, "true"));
  activeKeyCache = null;
  const { kid } = await ensureActiveKey();
  await logAudit(actorUserId, "sso.signing_key_rotated", "sso_signing_key", kid);
  return { kid };
}

/** Public JWKS — every key we've ever signed with that a verifier might still need, keyed by `kid`. */
export async function getJwks(): Promise<{ keys: JWK[] }> {
  await ensureActiveKey(); // guarantees at least one key exists, even before any token has been issued
  const rows = await db.select({ publicKeyJwk: ssoSigningKeysTable.publicKeyJwk }).from(ssoSigningKeysTable);
  return { keys: rows.map((r) => JSON.parse(r.publicKeyJwk) as JWK) };
}

/** Admin-facing status summary — never exposes private key material, only rotation metadata + resolved config. */
export async function getSsoKeyStatus() {
  await ensureActiveKey();
  const rows = await db
    .select({ kid: ssoSigningKeysTable.kid, isActive: ssoSigningKeysTable.isActive, createdAt: ssoSigningKeysTable.createdAt })
    .from(ssoSigningKeysTable)
    .orderBy(desc(ssoSigningKeysTable.createdAt));
  const active = rows.find((r) => r.isActive === "true");
  const [issuer, accessTokenTtlSeconds, refreshTokenTtlMs] = await Promise.all([
    getSsoIssuer(),
    getAccessTokenTtlSeconds(),
    getRefreshTokenTtlMs(),
  ]);
  return {
    activeKid: active?.kid ?? null,
    activeKeyCreatedAt: active?.createdAt ?? null,
    totalKeys: rows.length,
    keys: rows.map((r) => ({ kid: r.kid, isActive: r.isActive === "true", createdAt: r.createdAt })),
    config: {
      issuer,
      accessTokenTtlSeconds,
      refreshTokenTtlDays: Math.round(refreshTokenTtlMs / (24 * 60 * 60 * 1000)),
    },
  };
}

/** Issues a short-lived signed SSO access token for an authenticated admin, carrying their identity + effective roles. */
export async function issueAccessToken(userId: string, roles: AdminRoleName[], email: string | undefined, audience: SsoAudience, scope?: string[]): Promise<{ token: string; expiresIn: number }> {
  const { kid, privateKey } = await ensureActiveKey();
  const [issuer, ttlSeconds] = await Promise.all([getSsoIssuer(), getAccessTokenTtlSeconds()]);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ roles, email, ...(scope ? { scope } : {}) })
    .setProtectedHeader({ alg: "ES256", kid })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .setJti(randomUUID())
    .sign(privateKey);
  return { token, expiresIn: ttlSeconds };
}

/**
 * Verifies an SSO access token against our own JWKS. Trusted services are
 * expected to do this themselves against `GET /sso/jwks`, but this is used
 * for Signalium's own inbound verification (e.g. a `POST /sso/verify`
 * convenience endpoint for services that prefer a call over local JWKS
 * validation).
 *
 * `audience` is mandatory: an SSO token is only ever meaningful for the
 * specific service it was minted for, and accepting any audience here would
 * let a token issued for one service (e.g. `signalium-platform`) be replayed
 * against another (e.g. `signalium-trainer`) — a token-confusion attack.
 */
export async function verifyAccessToken(token: string, audience: SsoAudience): Promise<SsoTokenClaims> {
  const [{ keys }, issuer] = await Promise.all([getJwks(), getSsoIssuer()]);
  let lastErr: unknown;
  for (const jwk of keys) {
    try {
      const key = await importJWK(jwk, "ES256");
      const { payload } = await jwtVerify(token, key, { issuer, audience });
      return payload as unknown as SsoTokenClaims;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Token verification failed");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Issues a fresh access + refresh token pair for a user. The raw refresh token is returned once and never stored. */
export async function issueTokenPair(userId: string, roles: AdminRoleName[], email: string | undefined, audience: SsoAudience) {
  const access = await issueAccessToken(userId, roles, email, audience);
  const rawRefreshToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (await getRefreshTokenTtlMs()));
  await db.insert(ssoRefreshTokensTable).values({ userId, tokenHash: hashToken(rawRefreshToken), audience, expiresAt });
  await logAudit(userId, "sso.token_issued", "sso_token", userId, { audience, roles });
  return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken: rawRefreshToken };
}

/**
 * Rotates a refresh token: atomically claims it (single conditional UPDATE
 * that revokes it only if it is still unrevoked and unexpired), then issues
 * a new access + refresh pair. The conditional UPDATE — rather than a
 * read-then-write — is what makes rotation single-use under concurrency: two
 * simultaneous refresh calls for the same token can no longer both pass a
 * stale read and each mint a valid successor.
 */
export async function refreshTokenPair(rawRefreshToken: string) {
  const tokenHash = hashToken(rawRefreshToken);
  const [claimed] = await db
    .update(ssoRefreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(ssoRefreshTokensTable.tokenHash, tokenHash), isNull(ssoRefreshTokensTable.revokedAt), gt(ssoRefreshTokensTable.expiresAt, new Date())))
    .returning();
  if (!claimed) throw new Error("Refresh token is invalid, expired, or revoked");

  const { getEffectiveAdminRoles } = await import("./adminRoles");
  const roles = await getEffectiveAdminRoles(claimed.userId);

  const next = await issueTokenPair(claimed.userId, roles, undefined, claimed.audience as SsoAudience);
  const [nextRow] = await db.select({ id: ssoRefreshTokensTable.id }).from(ssoRefreshTokensTable).where(eq(ssoRefreshTokensTable.tokenHash, hashToken(next.refreshToken)));
  await db.update(ssoRefreshTokensTable).set({ replacedByTokenId: nextRow?.id }).where(eq(ssoRefreshTokensTable.id, claimed.id));
  await logAudit(claimed.userId, "sso.token_refreshed", "sso_token", claimed.userId, { audience: claimed.audience });
  return next;
}

/** Revokes a single refresh token (e.g. user signs out of one device/service). */
export async function revokeRefreshToken(actorUserId: string, rawRefreshToken: string): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  const [row] = await db.select().from(ssoRefreshTokensTable).where(eq(ssoRefreshTokensTable.tokenHash, tokenHash));
  if (!row || row.revokedAt) return;
  await db.update(ssoRefreshTokensTable).set({ revokedAt: new Date() }).where(eq(ssoRefreshTokensTable.id, row.id));
  await logAudit(actorUserId, "sso.token_revoked", "sso_token", row.userId);
}

/** Revokes every active refresh token for a user — immediately invalidates all their SSO sessions across services. */
export async function revokeAllTokensForUser(actorUserId: string, targetUserId: string): Promise<number> {
  const result = await db
    .update(ssoRefreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(ssoRefreshTokensTable.userId, targetUserId), isNull(ssoRefreshTokensTable.revokedAt)))
    .returning({ id: ssoRefreshTokensTable.id });
  await logAudit(actorUserId, "sso.all_tokens_revoked", "user", targetUserId, { count: result.length });
  return result.length;
}

// ─── Service-level tokens for Signalium's own outbound calls to Trainer ────
//
// Background/system call sites (qdeTrainer.ts) have no live admin session to
// delegate from, but Trainer must still never receive an unauthenticated
// request. This mints a short-lived token identifying Signalium itself
// (not a specific admin) with SuperAdmin-equivalent service scope, cached
// in-process and refreshed just before expiry.
let cachedServiceToken: { token: string; expiresAt: number } | null = null;

export async function getServiceToken(): Promise<string> {
  const now = Date.now();
  if (cachedServiceToken && cachedServiceToken.expiresAt - 30_000 > now) {
    return cachedServiceToken.token;
  }
  // Least-privilege by design: no admin roles are attached to this machine
  // identity — only the narrow `trainer.inference` scope Trainer actually
  // needs. If this token ever leaked, it grants nothing admin-equivalent.
  const { token, expiresIn } = await issueAccessToken("signalium-platform-service", [], undefined, SERVICE_TOKEN_AUDIENCE, ["trainer.inference"]);
  cachedServiceToken = { token, expiresAt: now + expiresIn * 1000 };
  return token;
}
