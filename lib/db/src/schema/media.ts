import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One row per uploaded media asset. `objectPath` points into object storage
// (e.g. "/objects/uploads/uuid"), and is what gets referenced from seo_pages
// (ogImage/twitterImage) or displayed directly (favicon/logo/hero).
export const mediaAssetsTable = pgTable("media_assets", {
  id: serial("id").primaryKey(),
  objectPath: text("object_path").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull().default(0),
  category: text("category", {
    enum: ["favicon", "logo", "hero", "social", "marketing", "other"],
  }).notNull().default("other"),
  altText: text("alt_text"),
  uploadedBy: text("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMediaAssetSchema = createInsertSchema(mediaAssetsTable).omit({ id: true, createdAt: true });
export type InsertMediaAsset = z.infer<typeof insertMediaAssetSchema>;
export type MediaAsset = typeof mediaAssetsTable.$inferSelect;
