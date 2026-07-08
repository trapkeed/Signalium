import { pgTable, text, serial, timestamp, integer, doublePrecision, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { apiKeysTable } from "./api-keys";
import { eaRegistrationsTable } from "./ea-registrations";

// ─── Position telemetry ──────────────────────────────────────────────────────
// One row per EA -> Platform telemetry frame (sent every ~30s per open
// position, or a zero-position "flat" frame when there's nothing open).
export const positionTelemetryTable = pgTable("position_telemetry", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  apiKeyId: integer("api_key_id").notNull().references(() => apiKeysTable.id),
  eaRegistrationId: integer("ea_registration_id").notNull().references(() => eaRegistrationsTable.id),
  symbol: text("symbol"),
  balance: doublePrecision("balance").notNull(),
  equity: doublePrecision("equity").notNull(),
  margin: doublePrecision("margin").notNull(),
  freeMargin: doublePrecision("free_margin").notNull(),
  openPositions: integer("open_positions").notNull().default(0),
  floatingPnl: doublePrecision("floating_pnl").notNull().default(0),
  entryPrice: doublePrecision("entry_price"),
  currentPrice: doublePrecision("current_price"),
  spread: doublePrecision("spread"),
  swap: doublePrecision("swap"),
  commission: doublePrecision("commission"),
  drawdown: doublePrecision("drawdown"),
  tradeAgeSeconds: integer("trade_age_seconds"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("position_telemetry_user_idx").on(table.userId),
  index("position_telemetry_ea_registration_idx").on(table.eaRegistrationId),
  index("position_telemetry_received_at_idx").on(table.receivedAt),
]);

export const insertPositionTelemetrySchema = createInsertSchema(positionTelemetryTable).omit({ id: true, receivedAt: true });
export type InsertPositionTelemetry = z.infer<typeof insertPositionTelemetrySchema>;
export type PositionTelemetry = typeof positionTelemetryTable.$inferSelect;

// ─── Trainer actions ─────────────────────────────────────────────────────────
// One row per Trainer -> Platform -> EA action, queued for delivery and
// tracked through delivered/acknowledged so the loop is observable end to end.
export const trainerActionsTable = pgTable("trainer_actions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  apiKeyId: integer("api_key_id").notNull().references(() => apiKeysTable.id),
  eaRegistrationId: integer("ea_registration_id").notNull().references(() => eaRegistrationsTable.id),
  telemetryId: integer("telemetry_id").notNull().references(() => positionTelemetryTable.id),
  symbol: text("symbol"),
  action: text("action", {
    enum: ["HOLD", "ADD", "REDUCE", "TRAIL", "BREAKEVEN", "LOCK_PROFIT", "CLOSE"],
  }).notNull(),
  reasoning: text("reasoning"),
  status: text("status", {
    enum: ["queued", "delivered", "acknowledged", "failed"],
  }).notNull().default("queued"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
}, (table) => [
  index("trainer_actions_ea_registration_idx").on(table.eaRegistrationId),
  index("trainer_actions_status_idx").on(table.status),
]);

export const insertTrainerActionSchema = createInsertSchema(trainerActionsTable).omit({
  id: true, createdAt: true, deliveredAt: true, acknowledgedAt: true,
});
export type InsertTrainerAction = z.infer<typeof insertTrainerActionSchema>;
export type TrainerAction = typeof trainerActionsTable.$inferSelect;

// ─── EA connection log ───────────────────────────────────────────────────────
// Observability record of the WebSocket connection lifecycle per terminal.
export const eaConnectionsTable = pgTable("ea_connections", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  apiKeyId: integer("api_key_id").notNull().references(() => apiKeysTable.id),
  eaRegistrationId: integer("ea_registration_id").notNull().references(() => eaRegistrationsTable.id),
  connectionId: text("connection_id").notNull(),
  transport: text("transport", { enum: ["websocket", "http_poll"] }).notNull().default("websocket"),
  status: text("status", { enum: ["connected", "disconnected"] }).notNull().default("connected"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  messageCount: integer("message_count").notNull().default(0),
}, (table) => [
  index("ea_connections_ea_registration_idx").on(table.eaRegistrationId),
  index("ea_connections_status_idx").on(table.status),
]);

export const insertEaConnectionSchema = createInsertSchema(eaConnectionsTable).omit({ id: true, connectedAt: true });
export type InsertEaConnection = z.infer<typeof insertEaConnectionSchema>;
export type EaConnection = typeof eaConnectionsTable.$inferSelect;
