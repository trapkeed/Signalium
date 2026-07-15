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
  source: text("source", { enum: ["admin", "ea", "broker", "auto"] }).notNull().default("admin"),
  // Nullable: which broker reports this raw alias, if known. Lets symbol
  // normalization reference the brokers registry without requiring it.
  brokerId: integer("broker_id").references(() => brokersTable.id),
  // Soft-disable: disabled aliases are excluded from normalization lookups but
  // preserved in the DB so admins can re-enable them without recreating them.
  enabled: boolean("enabled").notNull().default(true),
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

// ─── Broker symbol discovery: trainer/regex mapping cache ────────────────────
// Populated by the EA install-time broker symbol scan (POST
// /market-data/symbol-discovery): each discovered raw broker symbol is
// resolved (trainer round-trip, falling back to the local normalizer/regex
// engine if the trainer is unreachable/unconfigured) and cached here so the
// EA can be told to refresh only every 24h instead of re-resolving every
// scan. `canonicalSymbolId` is nullable — an alias can still be cached as
// "unresolved" so repeated scans don't keep hammering the trainer for a
// symbol nobody has mapped yet.
export const symbolMappingCacheTable = pgTable(
  "symbol_mapping_cache",
  {
    id: serial("id").primaryKey(),
    rawAlias: text("raw_alias").notNull(),
    brokerId: integer("broker_id").references(() => brokersTable.id),
    canonicalSymbolId: integer("canonical_symbol_id").references(() => symbolsTable.id),
    mappingSource: text("mapping_source", { enum: ["trainer", "regex_fallback", "admin", "local_normalizer"] }).notNull(),
    confidence: text("confidence"), // trainer-reported confidence, stored as text since it's advisory only
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const insertSymbolMappingCacheSchema = createInsertSchema(symbolMappingCacheTable).omit({ id: true, createdAt: true, refreshedAt: true });
export type InsertSymbolMappingCache = z.infer<typeof insertSymbolMappingCacheSchema>;
export type SymbolMappingCache = typeof symbolMappingCacheTable.$inferSelect;

// Logged whenever a newly-resolved mapping for a raw alias disagrees with
// what was previously cached (e.g. trainer now says EURUSDm -> EURUSD but an
// admin/regex mapping previously pointed it at a different canonical symbol).
// Surfaced in the admin symbols UI so a human can pick a winner.
export const symbolMappingConflictsTable = pgTable("symbol_mapping_conflicts", {
  id: serial("id").primaryKey(),
  rawAlias: text("raw_alias").notNull(),
  brokerId: integer("broker_id").references(() => brokersTable.id),
  previousSymbolId: integer("previous_symbol_id").references(() => symbolsTable.id),
  newSymbolId: integer("new_symbol_id").references(() => symbolsTable.id),
  source: text("source", { enum: ["trainer", "regex_fallback", "admin", "local_normalizer"] }).notNull(),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSymbolMappingConflictSchema = createInsertSchema(symbolMappingConflictsTable).omit({ id: true, createdAt: true });
export type InsertSymbolMappingConflict = z.infer<typeof insertSymbolMappingConflictSchema>;
export type SymbolMappingConflict = typeof symbolMappingConflictsTable.$inferSelect;

// Admin-approved regex fallback rules, tried when exact/alias/suffix-strip
// resolution AND the trainer round-trip both fail to resolve a raw broker
// symbol. Ordered by `priority` (lower runs first).
export const symbolRegexPatternsTable = pgTable("symbol_regex_patterns", {
  id: serial("id").primaryKey(),
  pattern: text("pattern").notNull(),
  symbolId: integer("symbol_id").notNull().references(() => symbolsTable.id),
  priority: integer("priority").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSymbolRegexPatternSchema = createInsertSchema(symbolRegexPatternsTable).omit({ id: true, createdAt: true });
export type InsertSymbolRegexPattern = z.infer<typeof insertSymbolRegexPatternSchema>;
export type SymbolRegexPattern = typeof symbolRegexPatternsTable.$inferSelect;
