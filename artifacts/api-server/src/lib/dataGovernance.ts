/**
 * S28 — Data Governance: consent, self-service export, and account deletion.
 */
import {
  db, usersTable, subscriptionsTable, subscriptionEventsTable, paymentsTable, apiKeysTable,
  eaRegistrationsTable, loginEventsTable, auditLogTable, consentRecordsTable,
  dataExportRequestsTable, accountDeletionRequestsTable,
} from "@workspace/db";
import { eq, or, sql } from "drizzle-orm";
import crypto from "crypto";
import { logAudit } from "./auditLog";
import { signArtifact } from "./requestSigning";
import { sendMail } from "./mailer";
import { logger } from "./logger";

export const DELETION_GRACE_PERIOD_DAYS = 14;

/**
 * Assembles a full export of everything the platform holds tied to this
 * user's id, across every table that carries one. Generated on demand and
 * returned synchronously rather than persisted, so we never hold a second
 * copy of the user's personal data at rest (data-minimization).
 */
export async function buildUserDataExport(userId: string) {
  const [
    profile, subscriptions, subscriptionEvents, payments, apiKeys,
    eaRegs, loginHistory, ownAuditEntries, consent,
  ] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, userId)),
    db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, userId)),
    db.select().from(subscriptionEventsTable).where(eq(subscriptionEventsTable.userId, userId)),
    db.select().from(paymentsTable).where(eq(paymentsTable.userId, userId)),
    db.select().from(apiKeysTable).where(eq(apiKeysTable.userId, userId)),
    db.select({ registration: eaRegistrationsTable }).from(eaRegistrationsTable)
      .innerJoin(apiKeysTable, eq(eaRegistrationsTable.apiKeyId, apiKeysTable.id))
      .where(eq(apiKeysTable.userId, userId)),
    db.select().from(loginEventsTable).where(eq(loginEventsTable.userId, userId)),
    db.select().from(auditLogTable).where(
      or(eq(auditLogTable.actorUserId, userId), eq(auditLogTable.targetId, userId)),
    ),
    db.select().from(consentRecordsTable).where(eq(consentRecordsTable.userId, userId)),
  ]);

  const exportedAt = new Date().toISOString();
  const data = {
    exportedAt,
    userId,
    profile: profile[0] ?? null,
    subscriptions,
    subscriptionEvents,
    payments,
    apiKeys: apiKeys.map((k) => ({ ...k, keyHash: undefined })), // never export the hash of a live credential
    eaRegistrations: eaRegs.map((r) => r.registration),
    loginHistory,
    auditLog: ownAuditEntries,
    consent,
  };

  // Sign the canonical JSON so the recipient (or a later auditor) can verify
  // the export was not altered after generation — a genuine use of
  // cryptographic signing distinct from the audit-log hash chain, which
  // protects the *log*, not this on-demand artifact.
  const canonical = JSON.stringify(data);
  const signature = signArtifact(canonical);
  return { data, signature, payloadHash: crypto.createHash("sha256").update(canonical).digest("hex") };
}

export async function recordDataExport(userId: string, payloadHash: string) {
  await db.insert(dataExportRequestsTable).values({ userId, status: "completed", payloadHash });
  await logAudit(userId, "data_export.completed", "user", userId, { payloadHash });
}

// ─── Account deletion ────────────────────────────────────────────────────────

export async function requestAccountDeletion(userId: string, email: string | null) {
  // Only one non-terminal request may exist per user (enforced by a partial
  // unique index) — check first so we can return a friendly error instead of
  // a raw constraint-violation exception on the (expected) double-click case.
  const existingActive = await db.select().from(accountDeletionRequestsTable).where(
    eq(accountDeletionRequestsTable.userId, userId),
  );
  if (existingActive.some((r) => r.status === "pending_confirmation" || r.status === "scheduled")) {
    return { alreadyActive: true as const };
  }

  const scheduledFor = new Date(Date.now() + DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const [request] = await db.insert(accountDeletionRequestsTable).values({
    userId, status: "pending_confirmation", scheduledFor,
  }).returning();

  // Reuses the same HMAC-signed-token pattern as requestSigning.ts, delivered
  // by email so deletion can't be triggered by a stolen session alone — the
  // requester must also control the account's inbox.
  const { signToken } = await import("./requestSigning");
  const token = signToken({ requestId: request.id, userId, kind: "account_deletion" }, 24 * 60 * 60 * 1000);

  await logAudit(userId, "account_deletion.requested", "user", userId, { requestId: request.id, scheduledFor: scheduledFor.toISOString() });

  if (email) {
    void sendMail({
      to: email,
      subject: "Signalium: Confirm account deletion",
      html: `<p>You requested to delete your Signalium account. This will deactivate your account, revoke API keys/EA access, cancel active subscriptions, and schedule permanent removal of your personal data ${DELETION_GRACE_PERIOD_DAYS} days from confirmation.</p>
        <p>If this was you, confirm using this token in Account &rarr; Privacy (valid 24 hours): <code>${token}</code></p>
        <p>If this wasn't you, ignore this email or cancel the pending request from Account &rarr; Privacy — no action is taken until confirmed.</p>`,
    });
  } else {
    logger.warn({ userId }, "Account deletion requested but user has no email on file — confirmation token not delivered");
  }

  return request;
}

export async function confirmAccountDeletion(userId: string, token: string) {
  const { verifyToken } = await import("./requestSigning");
  const result = verifyToken<{ requestId: number; userId: string; kind: string }>(token);
  if (!result.ok) return { ok: false as const, reason: result.reason };
  if (result.payload.userId !== userId || result.payload.kind !== "account_deletion") {
    return { ok: false as const, reason: "invalid_signature" as const };
  }

  const [request] = await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.id, result.payload.requestId));
  if (!request || request.userId !== userId || request.status !== "pending_confirmation") {
    return { ok: false as const, reason: "not_pending" as const };
  }

  const scheduledFor = request.scheduledFor ?? new Date(Date.now() + DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  await db.update(accountDeletionRequestsTable)
    .set({ status: "scheduled", confirmedAt: new Date(), scheduledFor })
    .where(eq(accountDeletionRequestsTable.id, request.id));
  await logAudit(userId, "account_deletion.confirmed", "user", userId, { requestId: request.id, scheduledFor: scheduledFor.toISOString() });
  return { ok: true as const, scheduledFor };
}

export async function cancelAccountDeletion(userId: string) {
  const pending = await db.select().from(accountDeletionRequestsTable).where(
    eq(accountDeletionRequestsTable.userId, userId),
  );
  const active = pending.find((r) => r.status === "pending_confirmation" || r.status === "scheduled");
  if (!active) return { ok: false as const };

  await db.update(accountDeletionRequestsTable)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(eq(accountDeletionRequestsTable.id, active.id));
  await logAudit(userId, "account_deletion.cancelled", "user", userId, { requestId: active.id });
  return { ok: true as const };
}

/**
 * Anonymizes and deactivates an account rather than hard-deleting the row —
 * financial records (payments/subscriptions) and the audit trail must
 * survive for the platform's own compliance/retention obligations, so we
 * scrub direct identifiers instead of removing history. Revokes all API keys
 * (cutting off EA/terminal access) and cancels active subscriptions.
 *
 * Also scrubs the direct-identifier fields left in other user-linked tables
 * (login metadata, consent IP/user-agent) — anonymizing only `users` while
 * leaving IP/device/location history keyed by the same userId elsewhere
 * would defeat the point of the deletion. The rows themselves (and their
 * booleans/timestamps, useful for security-anomaly trend data) are kept;
 * only the identifying strings are cleared.
 */
async function anonymizeAndDeactivateUser(userId: string) {
  await db.update(usersTable).set({
    email: `deleted-${userId}@deleted.invalid`,
    firstName: null,
    lastName: null,
    isActive: false,
  }).where(eq(usersTable.id, userId));

  await db.update(apiKeysTable).set({ status: "revoked" }).where(eq(apiKeysTable.userId, userId));

  await db.update(subscriptionsTable).set({
    status: "cancelled", cancelledAt: new Date(), endsAt: new Date(),
  }).where(eq(subscriptionsTable.userId, userId));

  // clerkSessionId is unique-indexed, so a per-user constant replacement
  // would collide across a user's multiple historical login rows — generate
  // a distinct placeholder per row at the DB level instead.
  await db.update(loginEventsTable).set({
    ipAddress: null, city: null, country: null, deviceType: null, browserName: null,
    browserVersion: null, fingerprint: null,
    clerkSessionId: sql`'deleted-' || gen_random_uuid()`,
  }).where(eq(loginEventsTable.userId, userId));

  await db.update(consentRecordsTable).set({
    ipAddress: null, userAgent: null,
  }).where(eq(consentRecordsTable.userId, userId));
}

/** Processes deletion requests whose grace period has elapsed. Idempotent. */
export async function processScheduledDeletions(): Promise<number> {
  const now = new Date();
  const due = await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.status, "scheduled"));

  let processed = 0;
  for (const request of due) {
    if (!request.scheduledFor || request.scheduledFor.getTime() > now.getTime()) continue;
    try {
      await anonymizeAndDeactivateUser(request.userId);
      await db.update(accountDeletionRequestsTable)
        .set({ status: "completed", completedAt: now })
        .where(eq(accountDeletionRequestsTable.id, request.id));
      await logAudit(request.userId, "account_deletion.completed", "user", request.userId, { requestId: request.id });
      processed++;
    } catch (err) {
      logger.error({ err, requestId: request.id }, "Failed to process scheduled account deletion");
    }
  }
  return processed;
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function startAccountDeletionSweep(intervalMs: number = 60 * 60_000): void {
  stopAccountDeletionSweep();
  processScheduledDeletions().catch((err) => logger.warn({ err }, "Initial account-deletion sweep failed"));
  sweepTimer = setInterval(() => {
    processScheduledDeletions().catch((err) => logger.warn({ err }, "Account-deletion sweep failed"));
  }, intervalMs);
  logger.info({ intervalMs }, "DataGovernance: account-deletion sweep started");
}

export function stopAccountDeletionSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
