import { pgTable, text, serial, timestamp, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Consent tracking ────────────────────────────────────────────────────────
// One row per (user, consentType) — the *current* consent state, not a full
// history. We keep this as an upsert-on-latest rather than an append-only log
// because a compliance audit needs to answer "what is this user's consent
// status right now", and the full history of *changes* to it is already
// captured for free in `audit_log` (every write here also calls logAudit).
export const consentRecordsTable = pgTable("consent_records", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  consentType: text("consent_type", {
    enum: ["terms_of_service", "privacy_policy", "marketing_communications"],
  }).notNull(),
  // Version string of the policy document the user consented to (e.g. a date
  // or semver tag) — required to answer "did they consent to *this*
  // version" after a policy update.
  version: text("version").notNull(),
  granted: boolean("granted").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("consent_records_user_type_idx").on(table.userId, table.consentType),
]);

export const insertConsentRecordSchema = createInsertSchema(consentRecordsTable).omit({ id: true, updatedAt: true });
export type InsertConsentRecord = z.infer<typeof insertConsentRecordSchema>;
export type ConsentRecord = typeof consentRecordsTable.$inferSelect;

// ─── Export-my-data ──────────────────────────────────────────────────────────
// Durable record that an export happened, independent of the payload itself
// (the payload is generated on demand and returned synchronously — see
// dataGovernance.ts — rather than stored, to avoid holding another copy of
// the user's personal data at rest). `payloadHash` lets an auditor verify a
// previously-downloaded export file wasn't altered after the fact.
export const dataExportRequestsTable = pgTable("data_export_requests", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  status: text("status", { enum: ["completed", "failed"] }).notNull(),
  payloadHash: text("payload_hash"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDataExportRequestSchema = createInsertSchema(dataExportRequestsTable).omit({ id: true, requestedAt: true });
export type InsertDataExportRequest = z.infer<typeof insertDataExportRequestSchema>;
export type DataExportRequest = typeof dataExportRequestsTable.$inferSelect;

// ─── Account deletion workflow ───────────────────────────────────────────────
// A user-initiated deletion request goes through a grace period (see
// dataGovernance.ts DELETION_GRACE_PERIOD_DAYS) before being actioned, so an
// accidental or coerced request can be cancelled. Confirmation is via an
// emailed HMAC-signed token (see requestSigning.ts) rather than a second
// password prompt, consistent with the existing unlock-token pattern in
// account-security.ts.
export const accountDeletionRequestsTable = pgTable("account_deletion_requests", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  status: text("status", {
    enum: ["pending_confirmation", "scheduled", "cancelled", "completed"],
  }).notNull().default("pending_confirmation"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
}, (table) => [
  // At most one non-terminal (pending_confirmation/scheduled) deletion
  // request per user — prevents ambiguous cancel/status lookups from ever
  // having to pick among several "active" rows for the same account.
  uniqueIndex("account_deletion_requests_one_active_idx")
    .on(table.userId)
    .where(sql`${table.status} in ('pending_confirmation', 'scheduled')`),
  index("account_deletion_requests_user_idx").on(table.userId),
]);

export const insertAccountDeletionRequestSchema = createInsertSchema(accountDeletionRequestsTable).omit({ id: true, requestedAt: true });
export type InsertAccountDeletionRequest = z.infer<typeof insertAccountDeletionRequestSchema>;
export type AccountDeletionRequest = typeof accountDeletionRequestsTable.$inferSelect;
