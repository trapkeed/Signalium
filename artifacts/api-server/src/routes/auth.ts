/**
 * Self-hosted authentication endpoints — replaces Clerk's hosted sign-in/up.
 *
 * Flows:
 *  - Signup/login by email+password. If SMTP is configured (an active row in
 *    smtp_settings) a 6-digit code is emailed and must be verified before the
 *    session is created; otherwise the user is signed in instantly.
 *  - "Continue with Google" — direct OAuth 2.0 authorization-code flow using
 *    admin-configured, encrypted credentials (lib/googleOAuth.ts).
 *
 * User provisioning (referral code + attribution + audit log) mirrors the
 * logic that used to run on first Clerk login inside account-security.ts.
 */
import { Router } from "express";
import crypto from "crypto";
import { db, usersTable, referralsTable, smtpSettingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { emailAuthCodesTable } from "@workspace/db";
import {
  hashPassword, verifyPassword, generateNumericCode, hashCode,
  createSession, setSessionCookie, clearSessionCookie, getAuth, revokeSession,
} from "../lib/auth";
import { generateUniqueReferralCode } from "../lib/referrals";
import { sendMail } from "../lib/mailer";
import { logAudit } from "../lib/auditLog";
import { getGoogleCredentials, buildGoogleAuthUrl, exchangeGoogleCode } from "../lib/googleOAuth";

const router = Router();

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

async function isSmtpConfigured(): Promise<boolean> {
  const [settings] = await db.select().from(smtpSettingsTable).where(eq(smtpSettingsTable.isActive, true));
  return !!settings;
}

async function provisionUser(params: {
  email: string; passwordHash: string | null; firstName?: string | null; lastName?: string | null;
  googleId?: string | null; emailVerified: boolean; referralCode?: string | null;
}) {
  const ownReferralCode = await generateUniqueReferralCode();
  const [user] = await db.insert(usersTable).values({
    email: params.email,
    passwordHash: params.passwordHash,
    googleId: params.googleId ?? null,
    emailVerified: params.emailVerified,
    firstName: params.firstName ?? null,
    lastName: params.lastName ?? null,
    referralCode: ownReferralCode,
  }).returning();

  if (params.referralCode) {
    const [referrer] = await db.select().from(usersTable).where(eq(usersTable.referralCode, params.referralCode));
    if (referrer && referrer.id !== user.id) {
      await db.insert(referralsTable).values({
        referrerUserId: referrer.id,
        referredUserId: user.id,
        referralCode: params.referralCode,
      });
    }
  }

  await logAudit(user.id, "user.account_created", "user", user.id, { email: user.email });
  return user;
}

function requestMeta(req: import("express").Request) {
  return { ip: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

function toSafeUser<T extends { passwordHash: string | null }>(user: T): Omit<T, "passwordHash"> {
  const { passwordHash, ...safe } = user;
  return safe;
}

async function completeLogin(req: import("express").Request, res: import("express").Response, userId: string) {
  const { ip, userAgent } = requestMeta(req);
  const { token } = await createSession(userId, ip, userAgent);
  setSessionCookie(res, token);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return res.json({ user: toSafeUser(user) });
}

// ─── Email + password ──────────────────────────────────────────────────────

router.post("/signup", async (req, res) => {
  const { email, password, firstName, lastName, referralCode } = req.body as {
    email?: string; password?: string; firstName?: string; lastName?: string; referralCode?: string;
  };
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (existing) return res.status(409).json({ error: "A user with this email already exists" });

    const passwordHash = await hashPassword(password);

    if (!(await isSmtpConfigured())) {
      const user = await provisionUser({ email, passwordHash, firstName, lastName, emailVerified: true, referralCode });
      return await completeLogin(req, res, user.id);
    }

    const code = generateNumericCode();
    await db.insert(emailAuthCodesTable).values({
      id: crypto.randomUUID(),
      email, purpose: "signup",
      codeHash: hashCode(code),
      pendingPasswordHash: passwordHash,
      pendingFirstName: firstName ?? null,
      pendingLastName: lastName ?? null,
      pendingReferralCode: referralCode ?? null,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    await sendMail({ to: email, subject: "Your Signalium verification code", html: `<p>Your verification code is <strong>${code}</strong>. It expires in 15 minutes.</p>` });
    return res.json({ requiresCode: true, email });
  } catch (err) {
    req.log.error(err, "Signup failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (!user.isActive) return res.status(403).json({ error: "This account has been deactivated" });

    if (!(await isSmtpConfigured())) {
      return await completeLogin(req, res, user.id);
    }

    const code = generateNumericCode();
    await db.insert(emailAuthCodesTable).values({
      id: crypto.randomUUID(),
      email, purpose: "login",
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    await sendMail({ to: email, subject: "Your Signalium login code", html: `<p>Your login code is <strong>${code}</strong>. It expires in 15 minutes.</p>` });
    return res.json({ requiresCode: true, email });
  } catch (err) {
    req.log.error(err, "Login failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/verify-code", async (req, res) => {
  const { email, code, purpose } = req.body as { email?: string; code?: string; purpose?: "signup" | "login" };
  if (!email || !code || !purpose) return res.status(400).json({ error: "email, code, and purpose are required" });

  try {
    // Most recent unconsumed code for this email/purpose.
    const rows = await db.select().from(emailAuthCodesTable)
      .where(and(eq(emailAuthCodesTable.email, email), eq(emailAuthCodesTable.purpose, purpose)));
    const pending = rows.filter((r) => !r.consumedAt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    if (!pending || pending.consumedAt || pending.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: "Code expired or not found — please request a new one" });
    }
    if (pending.attempts >= MAX_CODE_ATTEMPTS) {
      return res.status(429).json({ error: "Too many attempts — please request a new code" });
    }
    if (pending.codeHash !== hashCode(code)) {
      await db.update(emailAuthCodesTable).set({ attempts: pending.attempts + 1 }).where(eq(emailAuthCodesTable.id, pending.id));
      return res.status(400).json({ error: "Incorrect code" });
    }

    await db.update(emailAuthCodesTable).set({ consumedAt: new Date() }).where(eq(emailAuthCodesTable.id, pending.id));

    if (purpose === "signup") {
      const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
      const user = existing ?? await provisionUser({
        email,
        passwordHash: pending.pendingPasswordHash,
        firstName: pending.pendingFirstName,
        lastName: pending.pendingLastName,
        emailVerified: true,
        referralCode: pending.pendingReferralCode,
      });
      return await completeLogin(req, res, user.id);
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (!user) return res.status(404).json({ error: "User not found" });
    return await completeLogin(req, res, user.id);
  } catch (err) {
    req.log.error(err, "Code verification failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Google OAuth ("Continue with Google") ─────────────────────────────────

function googleRedirectUri(req: import("express").Request): string {
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  const host = req.get("host");
  return `${proto}://${host}/api/auth/google/callback`;
}

router.get("/google/start", async (req, res) => {
  try {
    const creds = await getGoogleCredentials();
    if (!creds) return res.status(503).json({ error: "Google sign-in is not configured" });

    const state = crypto.randomBytes(16).toString("hex");
    res.cookie("google_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 10 * 60 * 1000, path: "/" });
    const referralCode = typeof req.query.ref === "string" ? req.query.ref : undefined;
    if (referralCode) {
      res.cookie("google_oauth_ref", referralCode, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 10 * 60 * 1000, path: "/" });
    }
    return res.redirect(buildGoogleAuthUrl(creds.clientId, googleRedirectUri(req), state));
  } catch (err) {
    req.log.error(err, "Failed to start Google OAuth");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/google/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  const expectedState = req.cookies?.google_oauth_state as string | undefined;
  const referralCode = req.cookies?.google_oauth_ref as string | undefined;
  res.clearCookie("google_oauth_state", { path: "/" });
  res.clearCookie("google_oauth_ref", { path: "/" });

  if (!code || !state || !expectedState || state !== expectedState) {
    return res.redirect("/sign-in?error=google_oauth_failed");
  }

  try {
    const creds = await getGoogleCredentials();
    if (!creds) return res.redirect("/sign-in?error=google_oauth_not_configured");

    const profile = await exchangeGoogleCode(code, creds, googleRedirectUri(req));
    if (!profile.email) return res.redirect("/sign-in?error=google_oauth_failed");

    let [user] = await db.select().from(usersTable).where(eq(usersTable.googleId, profile.sub));
    if (!user) {
      [user] = await db.select().from(usersTable).where(eq(usersTable.email, profile.email));
      if (user) {
        [user] = await db.update(usersTable).set({ googleId: profile.sub, emailVerified: true }).where(eq(usersTable.id, user.id)).returning();
      } else {
        user = await provisionUser({
          email: profile.email, passwordHash: null, googleId: profile.sub,
          firstName: profile.given_name, lastName: profile.family_name,
          emailVerified: !!profile.email_verified, referralCode,
        });
      }
    }

    if (!user.isActive) return res.redirect("/sign-in?error=account_deactivated");

    const { ip, userAgent } = requestMeta(req);
    const { token } = await createSession(user.id, ip, userAgent);
    setSessionCookie(res, token);
    return res.redirect("/");
  } catch (err) {
    req.log.error(err, "Google OAuth callback failed");
    return res.redirect("/sign-in?error=google_oauth_failed");
  }
});

router.get("/google/status", async (_req, res) => {
  const creds = await getGoogleCredentials();
  return res.json({ enabled: !!creds });
});

// ─── Session lifecycle ──────────────────────────────────────────────────────

router.post("/logout", async (req, res) => {
  const { sessionId } = getAuth(req);
  if (sessionId) await revokeSession(sessionId);
  clearSessionCookie(res);
  return res.json({ ok: true });
});

router.get("/me", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  return res.json({ user: toSafeUser(user) });
});

export default router;
