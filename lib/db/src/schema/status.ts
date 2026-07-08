import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Singleton (single row, id fixed to 1) admin-set overall platform status.
// The public status endpoint overrides this with "maintenance" whenever the
// site-wide maintenance banner (see notifications.ts) is currently active —
// that override is computed at read time, not stored here, so the two
// systems can't drift out of sync.
export const platformStatusTable = pgTable("platform_status", {
  id: integer("id").primaryKey().default(1),
  status: text("status", { enum: ["operational", "degraded", "partial_outage", "major_outage"] }).notNull().default("operational"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlatformStatusSchema = createInsertSchema(platformStatusTable).omit({ id: true, updatedAt: true });
export type InsertPlatformStatus = z.infer<typeof insertPlatformStatusSchema>;
export type PlatformStatus = typeof platformStatusTable.$inferSelect;

// A manually-authored incident/update on the public status page (no
// automated detection in this phase — admins post and update these by hand).
export const statusIncidentsTable = pgTable("status_incidents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  impact: text("impact", { enum: ["minor", "major", "critical"] }).notNull().default("minor"),
  status: text("status", { enum: ["investigating", "identified", "monitoring", "resolved"] }).notNull().default("investigating"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const insertStatusIncidentSchema = createInsertSchema(statusIncidentsTable).omit({ id: true, createdAt: true, updatedAt: true, resolvedAt: true });
export type InsertStatusIncident = z.infer<typeof insertStatusIncidentSchema>;
export type StatusIncident = typeof statusIncidentsTable.$inferSelect;
