import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Per-user notification feed. Rows are fanned out at announcement-publish
// time (see announcementsTable) or inserted directly by other server-side
// flows (e.g. security/billing events) — there is no generic "broadcast to
// all users live" mechanism, fan-out is a one-time snapshot on publish.
export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type", { enum: ["announcement", "system", "security", "billing"] }).notNull().default("system"),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  announcementId: integer("announcement_id"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("notifications_user_id_idx").on(table.userId),
]);

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;

// Admin-authored announcements. On publish, one notification row is fanned
// out per targeted user (audience "all" = every user, "plan_tier" = users
// with an active subscription on the given plan tier). `showAsBanner` also
// surfaces the announcement as a dismissible-in-session banner while it's
// published and not expired.
export const announcementsTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audience: text("audience", { enum: ["all", "plan_tier"] }).notNull().default("all"),
  planTier: text("plan_tier", { enum: ["starter", "professional", "enterprise"] }),
  showAsBanner: boolean("show_as_banner").notNull().default(false),
  status: text("status", { enum: ["draft", "published", "retracted"] }).notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAnnouncementSchema = createInsertSchema(announcementsTable).omit({ id: true, createdAt: true, updatedAt: true, publishedAt: true, status: true });
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type Announcement = typeof announcementsTable.$inferSelect;

// Singleton (single-row, id fixed to 1) site-wide maintenance banner,
// admin-editable without a deploy. `isEnabled` is the manual on/off switch;
// startsAt/endsAt (both optional) additionally scope an enabled banner to a
// scheduled window — if set, the banner is only actually shown between them.
export const maintenanceBannerTable = pgTable("maintenance_banner", {
  id: integer("id").primaryKey().default(1),
  isEnabled: boolean("is_enabled").notNull().default(false),
  message: text("message").notNull().default(""),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMaintenanceBannerSchema = createInsertSchema(maintenanceBannerTable).omit({ id: true, updatedAt: true });
export type InsertMaintenanceBanner = z.infer<typeof insertMaintenanceBannerSchema>;
export type MaintenanceBanner = typeof maintenanceBannerTable.$inferSelect;
