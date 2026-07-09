import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── S29 — IP reputation / blocklist ────────────────────────────────────────
// Populated automatically when a single IP accumulates repeated open
// security_incidents (brute force, API abuse, replay attempts) rather than
// from a third-party reputation feed — this platform has no such
// integration, and a fabricated "reputation score" would be worse than
// none. Checked by `ipReputationGate` before any route handling.
export const ipBlocklistTable = pgTable("ip_blocklist", {
  id: serial("id").primaryKey(),
  ipAddress: text("ip_address").notNull().unique(),
  reason: text("reason").notNull(),
  // Auto entries expire so a transient false positive (shared NAT IP, etc)
  // self-heals; manually-added entries (expiresAt null) persist until
  // explicitly removed by an admin.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  addedBy: text("added_by"), // null when added automatically by a detector
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIpBlocklistSchema = createInsertSchema(ipBlocklistTable).omit({ id: true, createdAt: true });
export type InsertIpBlocklist = z.infer<typeof insertIpBlocklistSchema>;
export type IpBlocklistEntry = typeof ipBlocklistTable.$inferSelect;

// ─── S29 — Maker-checker approval workflow for critical admin actions ──────
// Generic pending-approval record: an actor proposes a sensitive action, a
// *different* sufficiently-privileged admin must approve it before
// `resolveIfApproved`-style code actually executes it. Currently wired to
// role escalation (granting admin/super_admin); designed to be reused for
// other destructive actions without a new table per action type.
export const adminActionApprovalsTable = pgTable("admin_action_approvals", {
  id: serial("id").primaryKey(),
  actionType: text("action_type", {
    enum: ["role_escalation"],
  }).notNull(),
  requestedBy: text("requested_by").notNull(),
  targetId: text("target_id").notNull(), // e.g. the userId whose role is being escalated
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected", "cancelled"] }).notNull().default("pending"),
  approvedBy: text("approved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("admin_action_approvals_active_idx")
    .on(table.actionType, table.targetId),
]);

export const insertAdminActionApprovalSchema = createInsertSchema(adminActionApprovalsTable).omit({ id: true, createdAt: true });
export type InsertAdminActionApproval = z.infer<typeof insertAdminActionApprovalSchema>;
export type AdminActionApproval = typeof adminActionApprovalsTable.$inferSelect;

// ─── S29 — Admin session activity tracking (idle timeout) ──────────────────
// Clerk manages the underlying session lifetime, but doesn't give us a way
// to enforce a *shorter*, privilege-scoped idle timeout for admin-panel
// access specifically. One row per Clerk session id, touched on every
// successful admin/staff-gated request; `requireAdmin`-family middleware
// rejects if the gap since `lastSeenAt` exceeds the idle threshold.
export const adminSessionActivityTable = pgTable("admin_session_activity", {
  clerkSessionId: text("clerk_session_id").primaryKey(),
  userId: text("user_id").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminSessionActivity = typeof adminSessionActivityTable.$inferSelect;
