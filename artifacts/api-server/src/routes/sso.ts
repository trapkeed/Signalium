/**
 * S24C — SSO Identity Provider endpoints.
 *
 * Signalium is the single authentication authority for the ecosystem.
 * These endpoints let an authenticated Signalium admin obtain a signed
 * token that Signalium Trainer (or any future internal service) can verify
 * — Trainer never stores passwords or authenticates administrators itself.
 *
 * `/jwks` is intentionally public (no auth) — that is the point of a JWKS
 * endpoint: verifiers fetch our public keys to validate tokens themselves,
 * without a shared secret. Every other endpoint requires an authenticated
 * Signalium admin session.
 */
import { Router } from "express";
import { getAuth } from "../lib/auth";
import { requireStaff } from "../middlewares/requireAdmin";
import { getEffectiveAdminRoles } from "../lib/adminRoles";
import { getJwks, issueTokenPair, refreshTokenPair, revokeRefreshToken, revokeAllTokensForUser, verifyAccessToken, rotateSigningKey, getSsoKeyStatus, type SsoAudience } from "../lib/sso";
import { requireSuperAdmin } from "../middlewares/requireAdmin";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const VALID_AUDIENCES: SsoAudience[] = ["signalium-trainer", "signalium-platform"];
function isValidAudience(v: unknown): v is SsoAudience {
  return typeof v === "string" && VALID_AUDIENCES.includes(v as SsoAudience);
}

// Public — verifiers fetch our signing keys here, no auth required.
router.get("/jwks", async (_req, res) => {
  return res.json(await getJwks());
});

router.post("/token", requireStaff, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const audience = isValidAudience(req.body?.audience) ? req.body.audience : "signalium-trainer";
  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
  const roles = await getEffectiveAdminRoles(userId);
  const pair = await issueTokenPair(userId, roles, user?.email, audience);
  return res.json(pair);
});

router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body ?? {};
  if (typeof refreshToken !== "string" || !refreshToken) return res.status(400).json({ error: "refreshToken is required" });
  try {
    const pair = await refreshTokenPair(refreshToken);
    return res.json(pair);
  } catch (err) {
    return res.status(401).json({ error: (err as Error).message });
  }
});

router.post("/revoke", requireStaff, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { refreshToken } = req.body ?? {};
  if (typeof refreshToken !== "string" || !refreshToken) return res.status(400).json({ error: "refreshToken is required" });
  await revokeRefreshToken(userId, refreshToken);
  return res.json({ ok: true });
});

// Revoke every SSO session for a user. Self-service by default; a
// SuperAdmin may target another user (e.g. offboarding, suspected compromise).
router.post("/revoke-all", requireStaff, async (req, res) => {
  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });
  const targetUserId = typeof req.body?.userId === "string" ? req.body.userId : actorUserId;
  if (targetUserId !== actorUserId) {
    const roles = await getEffectiveAdminRoles(actorUserId);
    if (!roles.includes("super_admin")) {
      return res.status(403).json({ error: "Only a SuperAdmin may revoke another user's sessions" });
    }
  }
  const count = await revokeAllTokensForUser(actorUserId, targetUserId);
  return res.json({ ok: true, revokedCount: count });
});

// Convenience verification for services that prefer a call over local JWKS
// validation. Not required — a trusted service can validate independently
// against GET /jwks — but offered so a lightweight integration doesn't need
// its own JWT library wired up on day one. `audience` is required: verifying
// without pinning the expected audience would let a token minted for one
// service be replayed against a caller that expected a different one.
router.post("/verify", async (req, res) => {
  const { token, audience } = req.body ?? {};
  if (typeof token !== "string" || !token) return res.status(400).json({ error: "token is required" });
  if (!isValidAudience(audience)) return res.status(400).json({ error: "audience is required and must be a known SSO audience" });
  try {
    const claims = await verifyAccessToken(token, audience);
    return res.json({ valid: true, claims });
  } catch (err) {
    return res.status(200).json({ valid: false, error: (err as Error).message });
  }
});

router.post("/rotate-signing-key", requireSuperAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const result = await rotateSigningKey(userId);
  return res.json(result);
});

// Admin-facing status: rotation history + resolved issuer/expiration config.
// Never returns private key material — only kid/isActive/createdAt per key.
router.get("/key-status", requireSuperAdmin, async (_req, res) => {
  const status = await getSsoKeyStatus();
  return res.json(status);
});

export default router;
