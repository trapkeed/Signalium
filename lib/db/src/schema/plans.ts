import { pgTable, text, serial, timestamp, boolean, real, integer, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const plansTable = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  priceMonthly: real("price_monthly").notNull().default(0),
  features: json("features").$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  tier: text("tier", { enum: ["starter", "professional", "enterprise"] }).notNull().default("starter"),
  maxEas: integer("max_eas"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlanSchema = createInsertSchema(plansTable).omit({ id: true, createdAt: true });
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plansTable.$inferSelect;
