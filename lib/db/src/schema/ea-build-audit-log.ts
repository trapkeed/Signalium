import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { eaBuildsTable } from "./ea-builds";

export const eaBuildAuditLogTable = pgTable("ea_build_audit_log", {
  id: serial("id").primaryKey(),
  buildId: integer("build_id").notNull().references(() => eaBuildsTable.id),
  userId: text("user_id").notNull(),
  action: text("action", { enum: ["generated", "downloaded", "regenerated", "revoked"] }).notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEaBuildAuditLogSchema = createInsertSchema(eaBuildAuditLogTable).omit({ id: true, createdAt: true });
export type InsertEaBuildAuditLog = z.infer<typeof insertEaBuildAuditLogSchema>;
export type EaBuildAuditLog = typeof eaBuildAuditLogTable.$inferSelect;
