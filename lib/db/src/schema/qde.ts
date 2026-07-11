import { pgTable, text, serial, timestamp, integer, doublePrecision, index, boolean, uniqueIndex, bigint } from "drizzle-orm/pg-core";
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

// ─── Trainer actions (commands) ──────────────────────────────────────────────
// One row per Trainer -> Platform -> EA command, queued for delivery and
// tracked through delivered/acknowledged so the loop is observable end to end.
//
// `sequenceNum` is a per-registration monotonic counter that guarantees
// command ordering. EAs MUST process commands in sequence_num order and
// MUST reject/re-request if they detect a gap. Null on legacy rows pre-C8.
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
  // Monotonic per-EA sequence number for ordering guarantees (C8).
  // Assigned atomically at insert time; null only on rows created before C8.
  sequenceNum: integer("sequence_num"),
  status: text("status", {
    enum: ["queued", "delivered", "acknowledged", "confirmed", "failed"],
  }).notNull().default("queued"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (table) => [
  index("trainer_actions_ea_registration_idx").on(table.eaRegistrationId),
  index("trainer_actions_status_idx").on(table.status),
  index("trainer_actions_seq_idx").on(table.eaRegistrationId, table.sequenceNum),
]);

export const insertTrainerActionSchema = createInsertSchema(trainerActionsTable).omit({
  id: true, createdAt: true, deliveredAt: true, acknowledgedAt: true, confirmedAt: true,
});
export type InsertTrainerAction = z.infer<typeof insertTrainerActionSchema>;
export type TrainerAction = typeof trainerActionsTable.$inferSelect;

// ─── Open positions ───────────────────────────────────────────────────────────
// Live state of each broker-held position per EA terminal. Upserted on every
// position-sync frame; the EA's broker ticket ID is the natural key.
// "Closed" positions are not deleted — closePrice / closedAt are set instead,
// providing an immutable record of the position's full lifecycle.
//
// Broker adapter is identified by `brokerType` (e.g. "MT5") so future adapters
// can be added without schema changes.
export const openPositionsTable = pgTable("open_positions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  eaRegistrationId: integer("ea_registration_id").notNull().references(() => eaRegistrationsTable.id),
  // Broker-assigned ticket identifier (MT5: integer ticket; other brokers: string).
  brokerTicketId: text("broker_ticket_id").notNull(),
  brokerType: text("broker_type", { enum: ["MT5", "GENERIC"] }).notNull().default("MT5"),
  symbol: text("symbol").notNull(),
  side: text("side", { enum: ["buy", "sell"] }).notNull(),
  lots: doublePrecision("lots").notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  currentPrice: doublePrecision("current_price"),
  stopLoss: doublePrecision("stop_loss"),
  takeProfit: doublePrecision("take_profit"),
  swap: doublePrecision("swap"),
  commission: doublePrecision("commission"),
  floatingPnl: doublePrecision("floating_pnl"),
  tradeAgeSeconds: integer("trade_age_seconds"),
  // MT5-specific metadata (ignored for other broker types).
  mt5Magic: bigint("mt5_magic", { mode: "number" }),
  mt5Comment: text("mt5_comment"),
  // Position lifecycle timestamps.
  openedAt: timestamp("opened_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closePrice: doublePrecision("close_price"),
  closePnl: doublePrecision("close_pnl"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("open_positions_ea_ticket_idx").on(table.eaRegistrationId, table.brokerTicketId),
  index("open_positions_user_idx").on(table.userId),
  index("open_positions_ea_registration_idx").on(table.eaRegistrationId),
  index("open_positions_symbol_idx").on(table.symbol),
  index("open_positions_closed_at_idx").on(table.closedAt),
]);

export const insertOpenPositionSchema = createInsertSchema(openPositionsTable).omit({ id: true, firstSeenAt: true, syncedAt: true });
export type InsertOpenPosition = z.infer<typeof insertOpenPositionSchema>;
export type OpenPosition = typeof openPositionsTable.$inferSelect;

// ─── Broker tickets ───────────────────────────────────────────────────────────
// Immutable audit log of broker ticket events (opened / modified / closed).
// Written once per event type per ticket; never updated.
export const brokerTicketsTable = pgTable("broker_tickets", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  eaRegistrationId: integer("ea_registration_id").notNull().references(() => eaRegistrationsTable.id),
  brokerTicketId: text("broker_ticket_id").notNull(),
  brokerType: text("broker_type", { enum: ["MT5", "GENERIC"] }).notNull().default("MT5"),
  symbol: text("symbol").notNull(),
  side: text("side", { enum: ["buy", "sell"] }).notNull(),
  lots: doublePrecision("lots").notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  // Event type: "opened" when first seen in a sync; "modified" on size/price changes;
  // "closed" when the ticket disappears from the position list.
  event: text("event", { enum: ["opened", "modified", "closed"] }).notNull(),
  eventPrice: doublePrecision("event_price"),
  eventLots: doublePrecision("event_lots"),
  eventPnl: doublePrecision("event_pnl"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("broker_tickets_ea_registration_idx").on(table.eaRegistrationId),
  index("broker_tickets_ticket_idx").on(table.brokerTicketId),
  index("broker_tickets_recorded_at_idx").on(table.recordedAt),
]);

export const insertBrokerTicketSchema = createInsertSchema(brokerTicketsTable).omit({ id: true, recordedAt: true });
export type InsertBrokerTicket = z.infer<typeof insertBrokerTicketSchema>;
export type BrokerTicket = typeof brokerTicketsTable.$inferSelect;

// ─── Execution confirmations ──────────────────────────────────────────────────
// EA-reported result of executing a command. Separate from "acknowledged" (which
// just means "message received"); a confirmation records what the broker actually
// did — the ticket that was opened/closed, the price achieved, and whether the
// execution succeeded. A command can have at most one confirmation.
export const executionConfirmationsTable = pgTable("execution_confirmations", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  eaRegistrationId: integer("ea_registration_id").notNull().references(() => eaRegistrationsTable.id),
  trainerActionId: integer("trainer_action_id").notNull().references(() => trainerActionsTable.id),
  // The broker ticket that was created or modified by this command (nullable for
  // actions that don't produce/close a ticket, e.g. HOLD or partial TRAIL).
  brokerTicketId: text("broker_ticket_id"),
  brokerType: text("broker_type", { enum: ["MT5", "GENERIC"] }).notNull().default("MT5"),
  executedAction: text("executed_action", {
    enum: ["HOLD", "ADD", "REDUCE", "TRAIL", "BREAKEVEN", "LOCK_PROFIT", "CLOSE"],
  }).notNull(),
  // Whether the EA successfully executed the command at the broker.
  success: boolean("success").notNull(),
  // Broker-reported execution prices / volumes (null if success=false or not applicable).
  actualPrice: doublePrecision("actual_price"),
  actualLots: doublePrecision("actual_lots"),
  slippage: doublePrecision("slippage"),
  executionDelayMs: integer("execution_delay_ms"),
  // Error description when success=false.
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("execution_confirmations_action_idx").on(table.trainerActionId),
  index("execution_confirmations_ea_registration_idx").on(table.eaRegistrationId),
  index("execution_confirmations_confirmed_at_idx").on(table.confirmedAt),
]);

export const insertExecutionConfirmationSchema = createInsertSchema(executionConfirmationsTable).omit({ id: true, confirmedAt: true });
export type InsertExecutionConfirmation = z.infer<typeof insertExecutionConfirmationSchema>;
export type ExecutionConfirmation = typeof executionConfirmationsTable.$inferSelect;

// ─── Broker state ────────────────────────────────────────────────────────────
// Live broker connection and account state per EA terminal. One row per
// registration (upserted on every broker-state sync). Provides a current
// snapshot of whether the EA is connected to its broker, the account health,
// and platform metadata — independent of position/telemetry data.
export const brokerStateTable = pgTable("broker_state", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  eaRegistrationId: integer("ea_registration_id").notNull().references(() => eaRegistrationsTable.id),
  brokerType: text("broker_type", { enum: ["MT5", "GENERIC"] }).notNull().default("MT5"),
  connectionStatus: text("connection_status", {
    enum: ["connected", "disconnected", "error"],
  }).notNull(),
  brokerServer: text("broker_server"),
  accountNumber: text("account_number"),
  accountCurrency: text("account_currency"),
  accountBalance: doublePrecision("account_balance"),
  accountEquity: doublePrecision("account_equity"),
  accountLeverage: integer("account_leverage"),
  accountMarginLevel: doublePrecision("account_margin_level"),
  pingMs: integer("ping_ms"),
  terminalBuild: text("terminal_build"),
  platformVersion: text("platform_version"),
  // MT5-specific: number of active trade permissions
  tradeAllowed: boolean("trade_allowed"),
  expertEnabled: boolean("expert_enabled"),
  errorMessage: text("error_message"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("broker_state_ea_registration_idx").on(table.eaRegistrationId),
  index("broker_state_user_idx").on(table.userId),
]);

export const insertBrokerStateSchema = createInsertSchema(brokerStateTable).omit({ id: true, syncedAt: true });
export type InsertBrokerState = z.infer<typeof insertBrokerStateSchema>;
export type BrokerState = typeof brokerStateTable.$inferSelect;

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
