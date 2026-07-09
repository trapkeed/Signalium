import {
  pgTable,
  text,
  serial,
  timestamp,
  boolean,
  integer,
  real,
  pgEnum,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { dataProvidersTable } from "./data-providers";
import { symbolsTable } from "./symbols";

// ─── Provider management ────────────────────────────────────────────────────

export const providerTypeEnum = pgEnum("provider_type", [
  "live",
  "historical",
  "calendar",
  "news",
  "sentiment",
]);

/**
 * API credentials for a data provider. Stored in the DB so admins can rotate
 * them without redeploying. Values are plaintext — the table is admin-only
 * and should be treated like secrets.
 */
export const providerCredentialsTable = pgTable("provider_credentials", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id")
    .notNull()
    .references(() => dataProvidersTable.id, { onDelete: "cascade" }),
  keyName: text("key_name").notNull(), // e.g. "api_key", "client_secret"
  keyValue: text("key_value").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
});

export type ProviderCredential = typeof providerCredentialsTable.$inferSelect;

/**
 * Live connectivity / health state for each provider. Upserted by the
 * ingestion worker on each poll cycle.
 */
export const providerStatusTable = pgTable("provider_status", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id")
    .notNull()
    .unique()
    .references(() => dataProvidersTable.id, { onDelete: "cascade" }),
  isReachable: boolean("is_reachable").notNull().default(false),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  latencyMs: integer("latency_ms"),
  errorMessage: text("error_message"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProviderStatus = typeof providerStatusTable.$inferSelect;

/**
 * What data types and timeframes each provider supports. One row per
 * provider × capability combination.
 */
export const providerCapabilitiesTable = pgTable(
  "provider_capabilities",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => dataProvidersTable.id, { onDelete: "cascade" }),
    capabilityType: providerTypeEnum("capability_type").notNull(),
    supportedTimeframes: text("supported_timeframes").array(), // ['M1','M5','H1','D1']
    maxHistoryDays: integer("max_history_days"),
    notes: text("notes"),
  },
  (t) => [uniqueIndex("provider_capability_unique").on(t.providerId, t.capabilityType)],
);

export type ProviderCapability = typeof providerCapabilitiesTable.$inferSelect;

/**
 * Maps a provider-specific symbol string to its canonical form. The QDE
 * only ever sees canonical symbols (EURUSD, XAUUSD, etc.).
 */
export const providerSymbolMappingsTable = pgTable(
  "provider_symbol_mappings",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => dataProvidersTable.id, { onDelete: "cascade" }),
    providerSymbol: text("provider_symbol").notNull(), // e.g. "EUR_USD", "XAUUSD.a"
    canonicalSymbolId: integer("canonical_symbol_id")
      .notNull()
      .references(() => symbolsTable.id, { onDelete: "cascade" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("provider_symbol_unique").on(t.providerId, t.providerSymbol)],
);

export type ProviderSymbolMapping = typeof providerSymbolMappingsTable.$inferSelect;

// ─── Inference controls (global admin switches) ──────────────────────────────

/**
 * Singleton row (id = 'global') for admin-controlled runtime switches.
 * Created on first access; defaults are safe (inference on, autonomous on).
 */
export const inferenceControlsTable = pgTable("inference_controls", {
  id: text("id").primaryKey(), // always "global"
  inferenceEnabled: boolean("inference_enabled").notNull().default(true),
  autonomousPaused: boolean("autonomous_paused").notNull().default(false),
  forcedModelVersion: text("forced_model_version"), // null = use trainer default
  liveProviderId: integer("live_provider_id").references(() => dataProvidersTable.id),
  fallbackProviderId: integer("fallback_provider_id").references(() => dataProvidersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"), // userId of last admin who changed this
});

export type InferenceControls = typeof inferenceControlsTable.$inferSelect;

// ─── Opportunity state machine ───────────────────────────────────────────────

export const opportunityStateEnum = pgEnum("opportunity_state", [
  "WATCHING",
  "BUILDING_CONTEXT",
  "PREPARING_ENTRY",
  "ENTRY_WINDOW",
  "POSITION_ACTIVE",
  "MANAGING_POSITION",
  "EXIT_PREPARATION",
  "EXITED",
  "COOLDOWN",
]);

/**
 * A trading opportunity tracked by the QDE. The state machine advances as the
 * model observes, qualifies, enters, manages, and exits a setup. The QDE
 * remembers unfinished setups across observation cycles.
 */
export const opportunitiesTable = pgTable("opportunities", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  symbol: text("symbol").notNull(), // canonical
  state: opportunityStateEnum("state").notNull().default("WATCHING"),
  direction: text("direction"), // "LONG" | "SHORT" | null if not yet determined
  confidence: real("confidence"), // 0–1
  entryPrice: real("entry_price"),
  currentPrice: real("current_price"),
  stopLoss: real("stop_loss"),
  takeProfit: real("take_profit"),
  reasoning: text("reasoning"),
  warnings: text("warnings").array(),
  riskSignal: text("risk_signal"),
  sizeSignal: text("size_signal"),
  entryUrgency: text("entry_urgency"),
  exitHorizon: text("exit_horizon"),
  relatedTelemetryId: integer("related_telemetry_id"),
  relatedActionId: integer("related_action_id"),
  metadata: jsonb("metadata"), // free-form model output
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  enteredAt: timestamp("entered_at", { withTimezone: true }),
  exitedAt: timestamp("exited_at", { withTimezone: true }),
  lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
  cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Opportunity = typeof opportunitiesTable.$inferSelect;

// ─── Market memory ───────────────────────────────────────────────────────────

export const marketMemoryKindEnum = pgEnum("market_memory_kind", [
  "failed_setup",
  "successful_setup",
  "regime_transition",
  "session_behavior",
  "volatility_behavior",
]);

/**
 * Runtime memory of notable market events. The QDE consults this before
 * generating inference decisions — "last time Gold behaved this way."
 *
 * Training memory lives in signalium-trainer. This is platform-side runtime
 * memory only: recent events within the current operational window.
 */
export const marketMemoryTable = pgTable("market_memory", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(), // canonical
  kind: marketMemoryKindEnum("kind").notNull(),
  description: text("description").notNull(),
  confidence: real("confidence"), // how strongly the pattern was observed
  outcome: text("outcome"), // what happened after
  metadata: jsonb("metadata"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }), // null = permanent
});

export type MarketMemory = typeof marketMemoryTable.$inferSelect;
