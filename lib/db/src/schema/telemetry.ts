import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const telemetryTable = pgTable("telemetry", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  eaId: integer("ea_id"),
  eventType: text("event_type", { enum: ["trade_open", "trade_close", "error", "info", "heartbeat", "startup", "shutdown"] }).notNull(),
  payload: text("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTelemetrySchema = createInsertSchema(telemetryTable).omit({ id: true, createdAt: true });
export type InsertTelemetry = z.infer<typeof insertTelemetrySchema>;
export type Telemetry = typeof telemetryTable.$inferSelect;
