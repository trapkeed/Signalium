import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const easTable = pgTable("eas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  version: text("version").notNull().default("1.0.0"),
  platform: text("platform", { enum: ["mt4", "mt5", "both"] }).notNull().default("both"),
  requiredTier: text("required_tier", { enum: ["starter", "professional", "enterprise"] }).notNull().default("starter"),
  isActive: boolean("is_active").notNull().default(true),
  downloadCount: integer("download_count").notNull().default(0),
  changeLog: text("change_log"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEaSchema = createInsertSchema(easTable).omit({ id: true, createdAt: true, updatedAt: true, downloadCount: true });
export type InsertEa = z.infer<typeof insertEaSchema>;
export type Ea = typeof easTable.$inferSelect;
