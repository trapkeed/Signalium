import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { apiKeysTable } from "./api-keys";

export const eaBuildsTable = pgTable("ea_builds", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  apiKeyId: integer("api_key_id").notNull().references(() => apiKeysTable.id),
  buildId: text("build_id").notNull().unique(),
  fileName: text("file_name").notNull(),
  platform: text("platform", { enum: ["mt5"] }).notNull().default("mt5"),
  platformVersion: text("platform_version").notNull().default("MT5"),
  subscriptionTier: text("subscription_tier", { enum: ["starter", "professional", "enterprise"] }).notNull(),
  status: text("status", { enum: ["active", "revoked", "superseded"] }).notNull().default("active"),
  metadata: jsonb("metadata").$type<{
    userId: string;
    apiKeyHash: string;
    buildId: string;
    subscriptionTier: string;
    generationTimestamp: string;
    platformVersion: string;
  }>().notNull(),
  storageObjectPath: text("storage_object_path").notNull(),
  checksum: text("checksum").notNull(),
  // S29 — HMAC signature over `checksum`, proving this build artifact was
  // produced by this server and hasn't been re-packaged/tampered with.
  // Nullable so pre-S29 builds remain valid rows without a backfill.
  signature: text("signature"),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  downloadCount: integer("download_count").notNull().default(0),
  lastDownloadedAt: timestamp("last_downloaded_at", { withTimezone: true }),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const insertEaBuildSchema = createInsertSchema(eaBuildsTable).omit({ id: true, generatedAt: true, downloadCount: true });
export type InsertEaBuild = z.infer<typeof insertEaBuildSchema>;
export type EaBuild = typeof eaBuildsTable.$inferSelect;
