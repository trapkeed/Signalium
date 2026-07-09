import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const apiKeysTable = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  status: text("status", { enum: ["active", "revoked", "expired", "suspended"] }).notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // S29 — per-key HMAC secret used to sign EA HTTP requests (x-signature /
  // x-timestamp / x-nonce headers). Never returned by any read endpoint
  // after key creation; stored so `resolveApiKeyAuth` can verify a request's
  // signature without re-deriving it from the (one-way-hashed) raw key.
  signingSecret: text("signing_secret"),
});

export const insertApiKeySchema = createInsertSchema(apiKeysTable).omit({ id: true, createdAt: true });
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeysTable.$inferSelect;
