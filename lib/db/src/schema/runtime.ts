import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const runtimeStatusTable = pgTable("runtime_status", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
  activeEas: integer("active_eas").notNull().default(0),
  accountId: text("account_id"),
  broker: text("broker"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRuntimeStatusSchema = createInsertSchema(runtimeStatusTable).omit({ updatedAt: true });
export type InsertRuntimeStatus = z.infer<typeof insertRuntimeStatusSchema>;
export type RuntimeStatus = typeof runtimeStatusTable.$inferSelect;
