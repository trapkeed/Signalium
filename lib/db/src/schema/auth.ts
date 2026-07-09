import { pgTable, text, timestamp, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Self-hosted auth — replaces Clerk. Sessions are opaque, server-side,
 * cookie-carried tokens (hashed at rest, like SSO refresh tokens) rather
 * than JWTs, so they can be revoked immediately (sign-out, admin idle
 * timeout, concurrent-session eviction) without waiting for expiry.
 */
export const sessionsTable = pgTable("auth_sessions", {
  id: text("id").primaryKey(), // random id, doubles as the Clerk-shaped "sessionId" callers already key on
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ createdAt: true, lastSeenAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;

/**
 * One-time email codes used for both signup verification and login
 * verification when SMTP is configured. When no SMTP configuration is
 * active, auth.ts skips this table entirely and signs the user in instantly
 * (see lib/auth.ts) — rows are only ever created in the SMTP-gated path.
 */
export const emailAuthCodesTable = pgTable("email_auth_codes", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  purpose: text("purpose", { enum: ["signup", "login"] }).notNull(),
  codeHash: text("code_hash").notNull(),
  // Carries the pending signup payload (password hash, name) until the code
  // is verified, since the user row shouldn't exist until then.
  pendingPasswordHash: text("pending_password_hash"),
  pendingFirstName: text("pending_first_name"),
  pendingLastName: text("pending_last_name"),
  pendingReferralCode: text("pending_referral_code"),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmailAuthCodeSchema = createInsertSchema(emailAuthCodesTable).omit({ id: true, createdAt: true });
export type InsertEmailAuthCode = z.infer<typeof insertEmailAuthCodeSchema>;
export type EmailAuthCode = typeof emailAuthCodesTable.$inferSelect;

/**
 * Admin-configurable OAuth provider credentials (currently just Google),
 * encrypted at rest via lib/secretsVault.ts — same pattern as admin_secrets,
 * but keyed by provider name since there's exactly one credential pair per
 * provider rather than an arbitrary key/value list. Shaped to extend to
 * future providers (GitHub, Microsoft, ...) without a schema change.
 */
export const oauthCredentialsTable = pgTable("oauth_credentials", {
  provider: text("provider").primaryKey(), // e.g. "google"
  encryptedClientId: text("encrypted_client_id").notNull(),
  encryptedClientSecret: text("encrypted_client_secret").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("oauth_credentials_provider_idx").on(table.provider),
]);

export const insertOauthCredentialSchema = createInsertSchema(oauthCredentialsTable).omit({ createdAt: true, updatedAt: true });
export type InsertOauthCredential = z.infer<typeof insertOauthCredentialSchema>;
export type OauthCredential = typeof oauthCredentialsTable.$inferSelect;
