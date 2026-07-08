import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Data providers are the market-data / feed sources (distinct from brokers,
// which are execution venues). Modeled as a simple managed list for now —
// no live feed integration, just admin-managed metadata.
export const dataProvidersTable = pgTable("data_providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  apiEndpoint: text("api_endpoint"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDataProviderSchema = createInsertSchema(dataProvidersTable).omit({ id: true, createdAt: true });
export type InsertDataProvider = z.infer<typeof insertDataProviderSchema>;
export type DataProvider = typeof dataProvidersTable.$inferSelect;
