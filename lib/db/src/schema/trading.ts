import { pgTable, text, serial, timestamp, integer, unique, jsonb } from "drizzle-orm/pg-core";
import { symbolsTable } from "./symbols";

export const userTradingSettingsTable = pgTable("user_trading_settings", {
  userId: text("user_id").primaryKey(),
  tradingMode: text("trading_mode", { enum: ["manual", "autonomous"] }).notNull().default("manual"),
  riskMode: text("risk_mode", { enum: ["manual", "qde"] }).notNull().default("manual"),
  // Broker-aware market data: last resolved source for this user, persisted
  // so switches can be detected (and audit-logged) across process restarts
  // rather than only via an in-memory cache.
  lastMarketSource: text("last_market_source", { enum: ["EXTERNAL_PROVIDER", "EA_FEED", "HYBRID"] }),
  lastMarketSourceAt: timestamp("last_market_source_at", { withTimezone: true }),
  lastMarketSourceDetail: jsonb("last_market_source_detail").$type<Record<string, unknown>>(),
  // Manual risk parameters — only consulted when riskMode = "manual"; passed
  // through to the QDE alongside signals so it respects user-specified sizing
  // instead of dynamically computing its own.
  riskParams: jsonb("risk_params").$type<{
    lotSize?: number;
    stopLossPips?: number;
    takeProfitPips?: number;
    maxDailyLossPct?: number;
  }>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserTradingSettings = typeof userTradingSettingsTable.$inferSelect;
export type InsertUserTradingSettings = typeof userTradingSettingsTable.$inferInsert;

export const userSymbolsTable = pgTable(
  "user_symbols",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    symbolId: integer("symbol_id")
      .notNull()
      .references(() => symbolsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("user_symbols_user_symbol_unique").on(table.userId, table.symbolId)],
);

export type UserSymbol = typeof userSymbolsTable.$inferSelect;
export type InsertUserSymbol = typeof userSymbolsTable.$inferInsert;
