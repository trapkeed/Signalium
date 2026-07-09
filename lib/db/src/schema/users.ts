import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";

export const usersTable = pgTable("users", {
  // App-generated id (no longer a Clerk id) — a random UUID minted at signup
  // time, before any row exists, so it can double as the FK every other
  // table already keys on (adminRoleAssignments, ssoRefreshTokens, etc need
  // no changes since they were always keyed on plain `text` user ids).
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  email: text("email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  // Null when the account was created via Google OAuth only (no password set).
  passwordHash: text("password_hash"),
  // Null unless the account is linked to a Google identity.
  googleId: text("google_id").unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  role: text("role", { enum: ["user", "clerk", "staff", "admin", "super_admin"] }).notNull().default("user"),
  isActive: boolean("is_active").notNull().default(true),
  // Unique shareable code for the referral program. Generated the first time
  // the user's row is provisioned (see account-security.ts sync-login, which
  // doubles as our user-provisioning hook since there is no signup webhook).
  referralCode: text("referral_code").notNull().unique(),
  // Self-service default provider for the payments page's "pay with" picker
  // (pre-selects this provider on the next payment intent). Not a foreign
  // key constraint at the DB level to avoid cross-schema-file import
  // ordering issues — validated at the route layer instead.
  preferredPaymentProviderId: integer("preferred_payment_provider_id"),
  // S30 — set when the user dismisses the onboarding checklist widget
  // without necessarily completing every step (e.g. an experienced user).
  onboardingDismissedAt: timestamp("onboarding_dismissed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
