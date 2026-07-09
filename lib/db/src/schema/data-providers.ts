import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Data providers are the market-data / feed sources (distinct from brokers,
// which are execution venues).
export const dataProvidersTable = pgTable("data_providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  apiEndpoint: text("api_endpoint"),
  isActive: boolean("is_active").notNull().default(true),
  // S18 additions
  priority: integer("priority").notNull().default(0), // lower number = higher priority
  fallbackForProviderId: integer("fallback_for_provider_id"), // self-ref FK added via migration
  inferenceEnabled: boolean("inference_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDataProviderSchema = createInsertSchema(dataProvidersTable).omit({ id: true, createdAt: true });
export type InsertDataProvider = z.infer<typeof insertDataProviderSchema>;
export type DataProvider = typeof dataProvidersTable.$inferSelect;
