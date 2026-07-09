import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// S24C — SSO Identity Provider. Signalium signs its own JWTs (asymmetric,
// ES256) so trusted services (signalium-trainer, future internal services)
// can verify tokens against our public JWKS without ever seeing a password
// or shared secret. The private key is generated once and persisted here
// (not as an env secret) so it survives restarts and can be rotated by
// inserting a new row — verification always tries the active key first,
// but old keys remain available (by `kid`) so already-issued tokens don't
// break mid-rotation.
export const ssoSigningKeysTable = pgTable("sso_signing_keys", {
  id: serial("id").primaryKey(),
  kid: text("kid").notNull().unique(),
  privateKeyPem: text("private_key_pem").notNull(),
  publicKeyJwk: text("public_key_jwk").notNull(),
  isActive: text("is_active", { enum: ["true", "false"] }).notNull().default("true"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SsoSigningKey = typeof ssoSigningKeysTable.$inferSelect;

// Opaque refresh tokens for SSO access-token issuance. Only the SHA-256 hash
// is stored — the raw token is returned to the caller once and never
// persisted, mirroring how API keys are handled elsewhere in this codebase.
export const ssoRefreshTokensTable = pgTable("sso_refresh_tokens", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  audience: text("audience").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  replacedByTokenId: integer("replaced_by_token_id"),
});

export const insertSsoRefreshTokenSchema = createInsertSchema(ssoRefreshTokensTable).omit({ id: true, createdAt: true });
export type InsertSsoRefreshToken = z.infer<typeof insertSsoRefreshTokenSchema>;
export type SsoRefreshToken = typeof ssoRefreshTokensTable.$inferSelect;
