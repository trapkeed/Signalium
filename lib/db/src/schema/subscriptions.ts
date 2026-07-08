import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { plansTable } from "./plans";

// Full subscription lifecycle state machine:
//   PENDING_PAYMENT -> ACTIVE -> GRACE_PERIOD -> EXPIRED
//                         |            |
//                         v            v (grace ends without payment)
//                     PAUSED / CANCELLED
// A missed/failed renewal moves ACTIVE -> GRACE_PERIOD (see `graceEndsAt`,
// a 7-day window). If the grace period lapses without renewal the
// EntitlementEngine's lazy lifecycle sync flips it to EXPIRED, revoking all
// entitlements. SUSPENDED is an admin/security action (e.g. fraud, chargeback)
// independent of the renewal calendar. See entitlementEngine.ts for the
// lazy-transition logic that keeps this in sync on read.
export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  planId: integer("plan_id").notNull().references(() => plansTable.id),
  status: text("status", {
    enum: ["pending_payment", "active", "grace_period", "suspended", "expired", "cancelled", "paused"],
  }).notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  // End of the current paid period / renewal due date. When this passes
  // while status is ACTIVE, the subscription lazily transitions to
  // GRACE_PERIOD (see entitlementEngine.ts).
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  // Deadline for GRACE_PERIOD -> EXPIRED (currentPeriodEnd + 7 days), set the
  // moment grace starts.
  graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
  // User has requested cancellation effective at the end of the current
  // paid period, rather than immediately.
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  // Terminal timestamp for backward-compat display ("ended on X") — set on
  // cancellation/expiry.
  endsAt: timestamp("ends_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;

// ─── Subscription event log ─────────────────────────────────────────────────
// Append-only audit trail of every lifecycle transition for a subscription,
// surfaced to admins/users as "event history". Distinct from the
// platform-wide audit_log table (audit-log.ts), which only records *admin*
// actions — this captures system-driven lifecycle transitions too (grace
// starting, expiry, renewal) so the full story of a subscription is visible.
export const subscriptionEventsTable = pgTable("subscription_events", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull().references(() => subscriptionsTable.id),
  userId: text("user_id").notNull(),
  eventType: text("event_type", {
    enum: [
      "SUBSCRIPTION_CREATED",
      "SUBSCRIPTION_RENEWED",
      "SUBSCRIPTION_UPGRADED",
      "SUBSCRIPTION_DOWNGRADED",
      "GRACE_STARTED",
      "GRACE_ENDED",
      "SUBSCRIPTION_EXPIRED",
      "SUBSCRIPTION_CANCELLED",
      "SUBSCRIPTION_PAUSED",
      "SUBSCRIPTION_RESUMED",
      "SUBSCRIPTION_SUSPENDED",
      "SUBSCRIPTION_REACTIVATED",
      "ADMIN_OVERRIDE",
    ],
  }).notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSubscriptionEventSchema = createInsertSchema(subscriptionEventsTable).omit({ id: true, createdAt: true });
export type InsertSubscriptionEvent = z.infer<typeof insertSubscriptionEventSchema>;
export type SubscriptionEvent = typeof subscriptionEventsTable.$inferSelect;
