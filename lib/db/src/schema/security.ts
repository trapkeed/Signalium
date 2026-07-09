import { pgTable, text, serial, timestamp, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One row per unique Clerk session the user has started. Since Replit-managed
// Clerk has no dashboard/webhook access, this is populated client-triggered
// (frontend calls POST /account/sync-login on session mount) and deduped
// server-side by clerkSessionId, rather than via a session.created webhook.
export const loginEventsTable = pgTable("login_events", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  clerkSessionId: text("clerk_session_id").notNull(),
  ipAddress: text("ip_address"),
  city: text("city"),
  country: text("country"),
  deviceType: text("device_type"),
  browserName: text("browser_name"),
  browserVersion: text("browser_version"),
  isMobile: boolean("is_mobile").notNull().default(false),
  isNewDevice: boolean("is_new_device").notNull().default(false),
  isSuspicious: boolean("is_suspicious").notNull().default(false),
  // S28 — session fingerprint: sha256(ipAddress|deviceType|browserName) at
  // the time of the event. Distinct from the raw fields above because it
  // gives compliance/anomaly-detection code one stable, opaque value to key
  // on (e.g. "how many distinct fingerprints has this user had this month")
  // without re-deriving the hash logic in every consumer.
  fingerprint: text("fingerprint"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("login_events_session_idx").on(table.clerkSessionId),
]);

export const insertLoginEventSchema = createInsertSchema(loginEventsTable).omit({ id: true, occurredAt: true });
export type InsertLoginEvent = z.infer<typeof insertLoginEventSchema>;
export type LoginEvent = typeof loginEventsTable.$inferSelect;

// One row per user tracking app-level account lock state. Locking is
// heuristic (repeated suspicious/new-device logins, or user-initiated panic
// button) rather than raw failed-password-attempt counting, since Clerk's
// hosted sign-in widget does not expose pre-session auth failures to our
// backend.
export const accountSecurityTable = pgTable("account_security", {
  userId: text("user_id").primaryKey(),
  isLocked: boolean("is_locked").notNull().default(false),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockReason: text("lock_reason"),
  unlockTokenHash: text("unlock_token_hash"),
  unlockTokenExpiresAt: timestamp("unlock_token_expires_at", { withTimezone: true }),
  recentSuspiciousCount: integer("recent_suspicious_count").notNull().default(0),
  lastSuspiciousAt: timestamp("last_suspicious_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAccountSecuritySchema = createInsertSchema(accountSecurityTable).omit({ updatedAt: true });
export type InsertAccountSecurity = z.infer<typeof insertAccountSecuritySchema>;
export type AccountSecurity = typeof accountSecurityTable.$inferSelect;
