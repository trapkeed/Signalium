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
  // Per-user master on/off switch for QDE-driven trading/analysis. Additive
  // to tradingMode/riskMode — this does not change how those work, it just
  // gates whether the user receives any QDE output at all. Independent of
  // the shared QDE model/trainer process and of other users' state.
  // "stopped" is the only inactive state; "initializing" and "running" are
  // both considered active (initializing = background warm-up in progress).
  qdeStatus: text("qde_status", { enum: ["stopped", "initializing", "running"] }).notNull().default("stopped"),
  qdeStatusUpdatedAt: timestamp("qde_status_updated_at", { withTimezone: true }),
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
