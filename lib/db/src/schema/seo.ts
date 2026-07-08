import { pgTable, text, serial, timestamp, integer, boolean, json, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type HreflangEntry = { lang: string; url: string };

// One row per logical page/route in the app. `path` is the app-relative route
// (e.g. "/", "/pricing") the frontend uses to look up its SEO config at
// render time via GET /seo/pages/resolve?path=.
export const seoPagesTable = pgTable("seo_pages", {
  id: serial("id").primaryKey(),
  path: text("path").notNull(),
  title: text("title"),
  description: text("description"),
  canonicalUrl: text("canonical_url"),
  ogTitle: text("og_title"),
  ogDescription: text("og_description"),
  ogImage: text("og_image"),
  twitterCard: text("twitter_card", { enum: ["summary", "summary_large_image"] }).notNull().default("summary_large_image"),
  twitterTitle: text("twitter_title"),
  twitterDescription: text("twitter_description"),
  twitterImage: text("twitter_image"),
  structuredData: json("structured_data").$type<Record<string, unknown> | null>(),
  hreflang: json("hreflang").$type<HreflangEntry[]>().notNull().default([]),
  noIndex: boolean("no_index").notNull().default(false),
  noFollow: boolean("no_follow").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("seo_pages_path_idx").on(table.path),
]);

export const insertSeoPageSchema = createInsertSchema(seoPagesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSeoPage = z.infer<typeof insertSeoPageSchema>;
export type SeoPage = typeof seoPagesTable.$inferSelect;

// Simple path-to-path redirect rules, evaluated by the frontend router (and
// optionally by the API server for direct hits) before falling through to
// normal routing.
export const seoRedirectsTable = pgTable("seo_redirects", {
  id: serial("id").primaryKey(),
  fromPath: text("from_path").notNull(),
  toPath: text("to_path").notNull(),
  statusCode: integer("status_code").notNull().default(301),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("seo_redirects_from_path_idx").on(table.fromPath),
]);

export const insertSeoRedirectSchema = createInsertSchema(seoRedirectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSeoRedirect = z.infer<typeof insertSeoRedirectSchema>;
export type SeoRedirect = typeof seoRedirectsTable.$inferSelect;

// Singleton (single-row, id fixed to 1) site-wide SEO settings: robots.txt
// content, sitemap toggle, and the canonical site URL used to build absolute
// URLs in the sitemap and canonical/OG tags.
export const seoSettingsTable = pgTable("seo_settings", {
  id: integer("id").primaryKey().default(1),
  robotsTxt: text("robots_txt").notNull().default("User-agent: *\nAllow: /\n"),
  sitemapEnabled: boolean("sitemap_enabled").notNull().default(true),
  siteUrl: text("site_url"),
  // Object-storage-backed URL (e.g. "/api/storage/objects/uploads/<id>") for
  // the site favicon, admin-editable from the Media Library. Falls back to
  // the static /favicon.svg link in index.html when unset.
  faviconUrl: text("favicon_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSeoSettingsSchema = createInsertSchema(seoSettingsTable).omit({ id: true, updatedAt: true });
export type InsertSeoSettings = z.infer<typeof insertSeoSettingsSchema>;
export type SeoSettings = typeof seoSettingsTable.$inferSelect;
