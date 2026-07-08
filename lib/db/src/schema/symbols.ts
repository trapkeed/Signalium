import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brokersTable } from "./brokers";

export const symbolCategoriesTable = pgTable("symbol_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSymbolCategorySchema = createInsertSchema(symbolCategoriesTable).omit({ id: true, createdAt: true });
export type InsertSymbolCategory = z.infer<typeof insertSymbolCategorySchema>;
export type SymbolCategory = typeof symbolCategoriesTable.$inferSelect;

export const symbolsTable = pgTable("symbols", {
  id: serial("id").primaryKey(),
  canonicalSymbol: text("canonical_symbol").notNull().unique(),
  displayName: text("display_name").notNull(),
  categoryId: integer("category_id").notNull().references(() => symbolCategoriesTable.id),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSymbolSchema = createInsertSchema(symbolsTable).omit({ id: true, createdAt: true });
export type InsertSymbol = z.infer<typeof insertSymbolSchema>;
export type Symbol = typeof symbolsTable.$inferSelect;

export const symbolAliasesTable = pgTable("symbol_aliases", {
  id: serial("id").primaryKey(),
  alias: text("alias").notNull().unique(),
  symbolId: integer("symbol_id").notNull().references(() => symbolsTable.id),
  source: text("source", { enum: ["admin", "ea", "broker"] }).notNull().default("admin"),
  // Nullable: which broker reports this raw alias, if known. Lets symbol
  // normalization reference the brokers registry without requiring it.
  brokerId: integer("broker_id").references(() => brokersTable.id),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSymbolAliasSchema = createInsertSchema(symbolAliasesTable).omit({ id: true, createdAt: true });
export type InsertSymbolAlias = z.infer<typeof insertSymbolAliasSchema>;
export type SymbolAlias = typeof symbolAliasesTable.$inferSelect;

export const symbolNormalizationLogTable = pgTable("symbol_normalization_log", {
  id: serial("id").primaryKey(),
  rawInput: text("raw_input").notNull(),
  resolvedSymbolId: integer("resolved_symbol_id").references(() => symbolsTable.id),
  resolved: boolean("resolved").notNull(),
  source: text("source", { enum: ["ea", "platform", "trainer", "admin_test"] }).notNull(),
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSymbolNormalizationLogSchema = createInsertSchema(symbolNormalizationLogTable).omit({ id: true, createdAt: true });
export type InsertSymbolNormalizationLog = z.infer<typeof insertSymbolNormalizationLogSchema>;
export type SymbolNormalizationLog = typeof symbolNormalizationLogTable.$inferSelect;
