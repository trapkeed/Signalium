import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, loginEventsTable, accountSecurityTable, usersTable, referralsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";
import { sendMail } from "../lib/mailer";
import { generateUniqueReferralCode } from "../lib/referrals";

const router = Router();

const SUSPICIOUS_LOCK_THRESHOLD = 3;
const SUSPICIOUS_WINDOW_MS = 24 * 60 * 60 * 1000;
const UNLOCK_TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function getOrCreateSecurity(userId: string) {
  const [existing] = await db.select().from(accountSecurityTable).where(eq(accountSecurityTable.userId, userId));
  if (existing) return existing;
  const [created] = await db.insert(accountSecurityTable).values({ userId }).returning();
  return created;
}

/**
 * Lazily provisions the `users` row for a Clerk-authenticated caller the
 * first time we ever see them (there is no signup webhook — see sync-login
 * below for why). No-op if the row already exists. On first-ever creation,
 * attributes a referral if a valid, non-self referral code was supplied —
 * this is the only moment attribution can happen, since it is the only time
 * we know "this is a brand-new user".
 */
async function ensureUserProvisioned(userId: string, referralCodeInput?: string | null) {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (existing) return existing;

  const clerkUser = await clerkClient.users.getUser(userId);
  const email = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress
    ?? clerkUser.emailAddresses[0]?.emailAddress
    ?? "";
  const referralCode = await generateUniqueReferralCode();

  const [created] = await db.insert(usersTable).values({
    id: userId,
    email,
    firstName: clerkUser.firstName,
    lastName: clerkUser.lastName,
    referralCode,
  }).onConflictDoNothing().returning();

  // A concurrent request may have won the race and created the row first;
  // fall back to reading it so callers always get a row back.
  const user = created ?? (await db.select().from(usersTable).where(eq(usersTable.id, userId)))[0];

  const trimmedInput = referralCodeInput?.trim().toUpperCase();
  if (created && trimmedInput) {
    const [referrer] = await db.select().from(usersTable).where(eq(usersTable.referralCode, trimmedInput));
    // Self-referral is structurally impossible here (a brand-new user cannot
    // yet know their own code), but guard explicitly for defense in depth.
    if (referrer && referrer.id !== userId) {
      await db.insert(referralsTable).values({
        referrerUserId: referrer.id,
        referredUserId: userId,
        referralCode: trimmedInput,
      }).onConflictDoNothing();
    }
  }

  return user;
}

// POST /account/sync-login — client-triggered session sync. Frontend calls
// this once per detected Clerk session (see ClerkQueryClientCacheInvalidator /
// App mount). Replit-managed Clerk has no dashboard/webhook access, so this
// stands in for a session.created webhook: dedupe by clerkSessionId, and pull
// real device/IP/geo data from Clerk's backend session activity.
router.post("/sync-login", async (req, res) => {
  const { userId, sessionId } = getAuth(req);
  if (!userId || !sessionId) return res.status(401).json({ error: "Unauthorized" });
  const { referralCode } = (req.body ?? {}) as { referralCode?: string };

  try {
    await ensureUserProvisioned(userId, referralCode);

    const [existing] = await db.select().from(loginEventsTable).where(eq(loginEventsTable.clerkSessionId, sessionId));
    if (existing) {
      const security = await getOrCreateSecurity(userId);
      return res.json({ event: existing, locked: security.isLocked });
    }

    let activity: {
      ipAddress?: string; city?: string; country?: string;
      deviceType?: string; browserName?: string; browserVersion?: string; isMobile?: boolean;
    } = {};
    try {
      const session = await clerkClient.sessions.getSession(sessionId);
      if (session.latestActivity) {
        activity = {
          ipAddress: session.latestActivity.ipAddress,
          city: session.latestActivity.city,
          country: session.latestActivity.country,
          deviceType: session.latestActivity.deviceType,
          browserName: session.latestActivity.browserName,
          browserVersion: session.latestActivity.browserVersion,
          isMobile: session.latestActivity.isMobile,
        };
      }
    } catch (err) {
      req.log.warn(err, "Failed to fetch Clerk session activity");
    }

    const priorEvents = await db.select().from(loginEventsTable)
      .where(eq(loginEventsTable.userId, userId))
      .orderBy(desc(loginEventsTable.occurredAt))
      .limit(20);

    // Missing activity data (Clerk lookup failed, or fields absent) must never be
    // treated as a "known" match — that would silently suppress detection. Only
    // count a match when we have concrete, non-null values to compare.
    const hasDeviceSignal = !!(activity.browserName && activity.deviceType && activity.ipAddress);
    const knownDevice = hasDeviceSignal && priorEvents.some(
      (e) => e.browserName === activity.browserName
        && e.deviceType === activity.deviceType
        && e.ipAddress === activity.ipAddress,
    );
    const knownCountry = !!activity.country && priorEvents.some((e) => e.country === activity.country);
    // Treat unresolvable activity data as an unknown device too, so we err
    // toward flagging rather than silently skipping detection.
    const isNewDevice = priorEvents.length > 0 && (!hasDeviceSignal || !knownDevice);
    // Flag suspicious when it's a new device signing in from an unrecognized country.
    // First-ever login is never flagged (nothing to compare against yet).
    const isSuspicious = priorEvents.length > 0 && isNewDevice && !knownCountry;

    const [event] = await db.insert(loginEventsTable).values({
      userId,
      clerkSessionId: sessionId,
      ipAddress: activity.ipAddress,
      city: activity.city,
      country: activity.country,
      deviceType: activity.deviceType,
      browserName: activity.browserName,
      browserVersion: activity.browserVersion,
      isMobile: activity.isMobile ?? false,
      isNewDevice,
      isSuspicious,
    }).returning();

    let security = await getOrCreateSecurity(userId);

    if (isSuspicious) {
      const withinWindow = security.lastSuspiciousAt
        && Date.now() - security.lastSuspiciousAt.getTime() < SUSPICIOUS_WINDOW_MS;
      const recentSuspiciousCount = (withinWindow ? security.recentSuspiciousCount : 0) + 1;
      const shouldLock = recentSuspiciousCount >= SUSPICIOUS_LOCK_THRESHOLD && !security.isLocked;

      const [updated] = await db.update(accountSecurityTable)
        .set({
          recentSuspiciousCount,
          lastSuspiciousAt: new Date(),
          ...(shouldLock
            ? { isLocked: true, lockedAt: new Date(), lockReason: "Multiple suspicious sign-ins detected" }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(accountSecurityTable.userId, userId))
        .returning();
      security = updated;

      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (user?.email) {
        if (shouldLock) {
          const token = crypto.randomBytes(24).toString("hex");
          await db.update(accountSecurityTable).set({
            unlockTokenHash: hashToken(token),
            unlockTokenExpiresAt: new Date(Date.now() + UNLOCK_TOKEN_TTL_MS),
          }).where(eq(accountSecurityTable.userId, userId));

          void sendMail({
            to: user.email,
            subject: "Signalium: Your account has been locked",
            html: `<p>We detected multiple suspicious sign-ins on your account and locked it as a precaution.</p>
              <p>Location: ${activity.city ?? "Unknown"}, ${activity.country ?? "Unknown"} — IP ${activity.ipAddress ?? "Unknown"}</p>
              <p>If this was you, verify your identity to unlock: use the unlock link in Account &rarr; Security, valid for 1 hour.</p>
              <p>Unlock token: <code>${token}</code></p>`,
          });
        } else {
          void sendMail({
            to: user.email,
            subject: "Signalium: New sign-in from an unrecognized device",
            html: `<p>We noticed a sign-in to your account from a new device/location.</p>
              <p>Location: ${activity.city ?? "Unknown"}, ${activity.country ?? "Unknown"} — IP ${activity.ipAddress ?? "Unknown"}</p>
              <p>If this wasn't you, review your active sessions and lock your account from Account &rarr; Security.</p>`,
          });
        }
      }
    }

    return res.json({ event, locked: security.isLocked });
  } catch (err) {
    req.log.error(err, "Failed to sync login");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /account/login-history — recent login/security timeline for current user
router.get("/login-history", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const events = await db.select().from(loginEventsTable)
      .where(eq(loginEventsTable.userId, userId))
      .orderBy(desc(loginEventsTable.occurredAt))
      .limit(50);
    return res.json(events);
  } catch (err) {
    req.log.error(err, "Failed to fetch login history");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /account/sessions — active Clerk sessions for the current user, with real
// device/IP/location data from Clerk's backend session activity.
router.get("/sessions", async (req, res) => {
  const { userId, sessionId: currentSessionId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { data: sessions } = await clerkClient.sessions.getSessionList({ userId, status: "active" });
    return res.json(sessions.map((s) => ({
      id: s.id,
      isCurrent: s.id === currentSessionId,
      status: s.status,
      lastActiveAt: new Date(s.lastActiveAt).toISOString(),
      createdAt: new Date(s.createdAt).toISOString(),
      expireAt: new Date(s.expireAt).toISOString(),
      ipAddress: s.latestActivity?.ipAddress ?? null,
      city: s.latestActivity?.city ?? null,
      country: s.latestActivity?.country ?? null,
      deviceType: s.latestActivity?.deviceType ?? null,
      browserName: s.latestActivity?.browserName ?? null,
      isMobile: s.latestActivity?.isMobile ?? false,
    })));
  } catch (err) {
    req.log.error(err, "Failed to list sessions");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /account/sessions/:sessionId/revoke — sign out one of the user's other devices
router.post("/sessions/:sessionId/revoke", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { sessionId } = req.params;

  try {
    const session = await clerkClient.sessions.getSession(sessionId);
    if (session.userId !== userId) return res.status(403).json({ error: "Forbidden" });

    await clerkClient.sessions.revokeSession(sessionId);
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "Failed to revoke session");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /account/security-status — lock status + suspicious activity summary
router.get("/security-status", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const security = await getOrCreateSecurity(userId);
    return res.json({
      isLocked: security.isLocked,
      lockedAt: security.lockedAt,
      lockReason: security.lockReason,
      recentSuspiciousCount: security.recentSuspiciousCount,
      lastSuspiciousAt: security.lastSuspiciousAt,
    });
  } catch (err) {
    req.log.error(err, "Failed to fetch security status");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /account/lock — self-service panic button: immediately lock own account
router.post("/lock", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    await getOrCreateSecurity(userId);
    const token = crypto.randomBytes(24).toString("hex");
    const [updated] = await db.update(accountSecurityTable).set({
      isLocked: true,
      lockedAt: new Date(),
      lockReason: "Locked manually by user",
      unlockTokenHash: hashToken(token),
      unlockTokenExpiresAt: new Date(Date.now() + UNLOCK_TOKEN_TTL_MS),
      updatedAt: new Date(),
    }).where(eq(accountSecurityTable.userId, userId)).returning();

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (user?.email) {
      void sendMail({
        to: user.email,
        subject: "Signalium: Your account was locked",
        html: `<p>Your account was locked at your request. Use the unlock token below to restore access (valid 1 hour).</p>
          <p>Unlock token: <code>${token}</code></p>`,
      });
    }

    return res.json({ isLocked: updated.isLocked, lockedAt: updated.lockedAt });
  } catch (err) {
    req.log.error(err, "Failed to lock account");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /account/unlock — clear a lock using the emailed token
router.post("/unlock", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: "token required" });

  try {
    const [security] = await db.select().from(accountSecurityTable).where(eq(accountSecurityTable.userId, userId));
    if (!security?.isLocked) return res.status(400).json({ error: "Account is not locked" });
    if (!security.unlockTokenHash || !security.unlockTokenExpiresAt || security.unlockTokenExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: "Unlock token expired or invalid" });
    }
    if (hashToken(token) !== security.unlockTokenHash) {
      return res.status(400).json({ error: "Invalid unlock token" });
    }

    await db.update(accountSecurityTable).set({
      isLocked: false,
      lockedAt: null,
      lockReason: null,
      unlockTokenHash: null,
      unlockTokenExpiresAt: null,
      recentSuspiciousCount: 0,
      lastSuspiciousAt: null,
      updatedAt: new Date(),
    }).where(eq(accountSecurityTable.userId, userId));

    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "Failed to unlock account");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
