import { Router } from "express";
import { getAuth, revokeSession } from "../lib/auth";
import { db, loginEventsTable, accountSecurityTable, usersTable, consentRecordsTable, accountDeletionRequestsTable, sessionsTable } from "@workspace/db";
import { eq, desc, and, gte, isNull } from "drizzle-orm";
import crypto from "crypto";
import { sendMail } from "../lib/mailer";
import { logAudit, listOwnAuditLog } from "../lib/auditLog";
import { buildUserDataExport, recordDataExport, requestAccountDeletion, confirmAccountDeletion, cancelAccountDeletion } from "../lib/dataGovernance";

const router = Router();

function computeFingerprint(ip?: string, deviceType?: string, browserName?: string): string | null {
  if (!ip && !deviceType && !browserName) return null;
  return crypto.createHash("sha256").update(`${ip ?? ""}|${deviceType ?? ""}|${browserName ?? ""}`).digest("hex");
}

// S29 — max concurrent active sessions per user; oldest-by-activity beyond
// this cap are revoked on each new login.
const MAX_CONCURRENT_SESSIONS = 5;

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

// Rough UA parsing — good enough for the security-timeline display; we
// don't need a full device-detection library just for this.
function parseUserAgent(ua?: string): { deviceType?: string; browserName?: string; browserVersion?: string; isMobile?: boolean } {
  if (!ua) return {};
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  let browserName: string | undefined;
  let browserVersion: string | undefined;
  const match = ua.match(/(Chrome|Firefox|Safari|Edge|OPR)\/([\d.]+)/);
  if (match) { browserName = match[1]; browserVersion = match[2]; }
  return { deviceType: isMobile ? "mobile" : "desktop", browserName, browserVersion, isMobile };
}

// POST /account/sync-login — client-triggered session-activity sync, called
// once per new session (see auth.ts createSession / App mount). Records a
// `login_events` row for the security timeline, keyed by our own session id
// (column is still named clerkSessionId — legacy column name, holds our
// session id now, see auth.ts sessionsTable).
router.post("/sync-login", async (req, res) => {
  const { userId, sessionId } = getAuth(req);
  if (!userId || !sessionId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [existing] = await db.select().from(loginEventsTable).where(eq(loginEventsTable.clerkSessionId, sessionId));
    if (existing) {
      const security = await getOrCreateSecurity(userId);
      return res.json({ event: existing, locked: security.isLocked });
    }

    // No geo-IP lookup service is wired up (Clerk previously provided city/country
    // via its activity API) — city/country are always unknown until one is added.
    const activity: { ipAddress?: string; city?: string; country?: string; deviceType?: string; browserName?: string; browserVersion?: string; isMobile?: boolean } = {
      ipAddress: req.ip, city: undefined, country: undefined, ...parseUserAgent(req.headers["user-agent"] as string | undefined),
    };

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
      fingerprint: computeFingerprint(activity.ipAddress, activity.deviceType, activity.browserName),
    }).returning();

    await logAudit(userId, "user.login_succeeded", "user", userId, {
      isNewDevice, isSuspicious, city: activity.city ?? null, country: activity.country ?? null,
    });

    // S29 — concurrent session limit: evict the oldest active session(s)
    // beyond MAX_CONCURRENT_SESSIONS. Never evicts the session that just
    // authenticated. Best-effort — a lookup failure here must not block the
    // login itself.
    try {
      const activeSessions = await db.select().from(sessionsTable)
        .where(and(eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt), gte(sessionsTable.expiresAt, new Date())));
      const sorted = [...activeSessions].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
      const toEvict = sorted.filter((s) => s.id !== sessionId).slice(MAX_CONCURRENT_SESSIONS - 1);
      for (const stale of toEvict) {
        await revokeSession(stale.id);
      }
      if (toEvict.length > 0) {
        await logAudit(userId, "user.session_evicted", "user", userId, {
          evictedSessionIds: toEvict.map((s) => s.id), reason: "concurrent_session_limit",
        });
      }
    } catch (err) {
      req.log.warn(err, "Failed to enforce concurrent session limit");
    }

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

// GET /account/sessions — active sessions for the current user.
router.get("/sessions", async (req, res) => {
  const { userId, sessionId: currentSessionId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const sessions = await db.select().from(sessionsTable)
      .where(and(eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt), gte(sessionsTable.expiresAt, new Date())))
      .orderBy(desc(sessionsTable.lastSeenAt));
    return res.json(sessions.map((s) => ({
      id: s.id,
      isCurrent: s.id === currentSessionId,
      status: "active",
      lastActiveAt: s.lastSeenAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      expireAt: s.expiresAt.toISOString(),
      ipAddress: s.ipAddress ?? null,
      city: null,
      country: null,
      deviceType: parseUserAgent(s.userAgent ?? undefined).deviceType ?? null,
      browserName: parseUserAgent(s.userAgent ?? undefined).browserName ?? null,
      isMobile: parseUserAgent(s.userAgent ?? undefined).isMobile ?? false,
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
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (!session || session.userId !== userId) return res.status(403).json({ error: "Forbidden" });

    await revokeSession(sessionId);
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

// ─── S28 Data Governance — self-service only, always scoped to the caller ───

// GET /account/audit-log — the caller's own audit trail (self-service view
// of the admin-only /audit-log listing, scoped so a normal user can never
// see another user's entries).
router.get("/audit-log", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const entries = await listOwnAuditLog(userId);
    return res.json(entries);
  } catch (err) {
    req.log.error(err, "Failed to fetch own audit log");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /account/consent — current consent state for the caller
router.get("/consent", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const records = await db.select().from(consentRecordsTable).where(eq(consentRecordsTable.userId, userId));
    return res.json(records);
  } catch (err) {
    req.log.error(err, "Failed to fetch consent");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /account/consent — record/update consent for one type
router.post("/consent", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { consentType, version, granted } = req.body as {
    consentType?: string; version?: string; granted?: boolean;
  };
  if (!consentType || !["terms_of_service", "privacy_policy", "marketing_communications"].includes(consentType)) {
    return res.status(400).json({ error: "Invalid consentType" });
  }
  if (!version) return res.status(400).json({ error: "version is required" });
  if (typeof granted !== "boolean") return res.status(400).json({ error: "granted must be a boolean" });

  try {
    const [record] = await db.insert(consentRecordsTable).values({
      userId,
      consentType: consentType as "terms_of_service" | "privacy_policy" | "marketing_communications",
      version,
      granted,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
    }).onConflictDoUpdate({
      target: [consentRecordsTable.userId, consentRecordsTable.consentType],
      set: { version, granted, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string | undefined, updatedAt: new Date() },
    }).returning();

    await logAudit(userId, "consent.recorded", "user", userId, { consentType, version, granted });
    return res.json(record);
  } catch (err) {
    req.log.error(err, "Failed to record consent");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /account/export-data — synchronous export of everything tied to the
// caller's account, cryptographically signed so the download can be
// verified later to be unmodified.
router.post("/export-data", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { data, signature, payloadHash } = await buildUserDataExport(userId);
    await recordDataExport(userId, payloadHash);
    return res.json({ data, signature, payloadHash });
  } catch (err) {
    req.log.error(err, "Failed to export account data");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /account/deletion-status — whether the caller has a pending/scheduled deletion
router.get("/deletion-status", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const requests = await db.select().from(accountDeletionRequestsTable).where(eq(accountDeletionRequestsTable.userId, userId));
    const active = requests.find((r) => r.status === "pending_confirmation" || r.status === "scheduled");
    return res.json({ active: active ?? null });
  } catch (err) {
    req.log.error(err, "Failed to fetch deletion status");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /account/delete-account — begin the deletion flow; sends a confirmation email
router.post("/delete-account", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const request = await requestAccountDeletion(userId, user?.email ?? null);
    if ("alreadyActive" in request) {
      return res.status(409).json({ error: "A deletion request is already pending or scheduled for this account" });
    }
    return res.status(201).json(request);
  } catch (err) {
    // The pre-check in requestAccountDeletion has a narrow race window
    // (two concurrent requests can both pass it before either inserts) —
    // the partial unique index on accountDeletionRequestsTable is the real
    // backstop, so a unique-violation here still means "already active",
    // not a server error.
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      return res.status(409).json({ error: "A deletion request is already pending or scheduled for this account" });
    }
    req.log.error(err, "Failed to request account deletion");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /account/delete-account/confirm — confirm via the emailed signed token
router.post("/delete-account/confirm", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: "token required" });
  try {
    const result = await confirmAccountDeletion(userId, token);
    if (!result.ok) return res.status(400).json({ error: `Invalid confirmation: ${result.reason}` });
    return res.json({ ok: true, scheduledFor: result.scheduledFor });
  } catch (err) {
    req.log.error(err, "Failed to confirm account deletion");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /account/delete-account/cancel — cancel a pending/scheduled deletion
router.post("/delete-account/cancel", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const result = await cancelAccountDeletion(userId);
    if (!result.ok) return res.status(400).json({ error: "No pending deletion request" });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "Failed to cancel account deletion");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
