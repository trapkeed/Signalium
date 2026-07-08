import { pgTable, text, serial, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { symbolsTable } from "./symbols";

export const userTradingSettingsTable = pgTable("user_trading_settings", {
  userId: text("user_id").primaryKey(),
  tradingMode: text("trading_mode", { enum: ["manual", "autonomous"] }).notNull().default("manual"),
  riskMode: text("risk_mode", { enum: ["manual", "qde"] }).notNull().default("manual"),
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
