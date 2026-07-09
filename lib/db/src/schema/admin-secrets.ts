import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Structured settings categories — one per config domain, replacing the
 * old flat/free-text category values. Kept here (not a DB enum type) so
 * adding a new domain never requires a migration-time enum ALTER.
 */
export const SETTINGS_CATEGORIES = [
  "auth",
  "payments",
  "email",
  "infra",
  "ai",
  "trainer",
  "market_data",
  "runpod",
  "ea_feed",
  "other",
] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

/**
 * Admin-managed secrets/API keys/env values, encrypted at rest (AES-256-GCM,
 * see lib/secretsVault.ts). This is separate from process.env — it's for
 * operator-entered credentials (third-party API keys, webhook secrets, etc.)
 * that need a durable, auditable, encrypted store with a UI, rather than
 * being set as Replit environment secrets which have no in-app visibility.
 */
export const adminSecretsTable = pgTable("admin_secrets", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  category: text("category", { enum: SETTINGS_CATEGORIES }).notNull().default("other"),
  encryptedValue: text("encrypted_value").notNull(),
  description: text("description"),
  // Soft-disable: when false, resolveManagedConfig() skips this row and
  // falls back to process.env, without losing the stored (encrypted) value
  // or its history. Distinct from delete, which removes the row entirely.
  isActive: boolean("is_active").notNull().default(true),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAdminSecretSchema = createInsertSchema(adminSecretsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAdminSecret = z.infer<typeof insertAdminSecretSchema>;
export type AdminSecret = typeof adminSecretsTable.$inferSelect;
