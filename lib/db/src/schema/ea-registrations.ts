import { pgTable, text, serial, timestamp, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { apiKeysTable } from "./api-keys";

export const eaRegistrationsTable = pgTable("ea_registrations", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").notNull().references(() => apiKeysTable.id),
  hardwareId: text("hardware_id").notNull(),
  mt5Account: text("mt5_account"),
  brokerName: text("broker_name"),
  brokerServer: text("broker_server"),
  terminalBuild: text("terminal_build"),
  platformVersion: text("platform_version"),
  isActive: boolean("is_active").notNull().default(true),
  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ea_registrations_api_key_hardware_idx").on(table.apiKeyId, table.hardwareId),
]);

export const insertEaRegistrationSchema = createInsertSchema(eaRegistrationsTable).omit({ id: true, registeredAt: true, lastSeenAt: true });
export type InsertEaRegistration = z.infer<typeof insertEaRegistrationSchema>;
export type EaRegistration = typeof eaRegistrationsTable.$inferSelect;
