/**
 * S22A — Platform Operational Infrastructure
 *
 * Tables for EA telemetry snapshots, per-EA heartbeat states, execution quality
 * aggregates, user risk alerts, operational incidents, and platform-wide alerts.
 */
import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  jsonb,
  boolean,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── 1. EA Telemetry Snapshots ────────────────────────────────────────────────
// One row per EA per report cycle (~30–60 s). Stores a full structured snapshot
// of account state, broker info, version strings, and execution stats.

export const eaTelemetrySnapshotsTable = pgTable(
  "ea_telemetry_snapshots",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    eaId: integer("ea_id"),
    accountId: text("account_id"),
    eaInstanceId: text("ea_instance_id"), // stable client-generated ID

    // Account metrics
    equity: real("equity"),
    balance: real("balance"),
    floatingPnL: real("floating_pnl"),
    marginLevel: real("margin_level"),
    freeMargin: real("free_margin"),
    openPositionsCount: integer("open_positions_count"),
    activeSymbols: text("active_symbols").array(),

    // Broker info
    brokerName: text("broker_name"),
    brokerServer: text("broker_server"),

    // Infrastructure
    vpsLatencyMs: integer("vps_latency_ms"),

    // Version strings
    eaVersion: text("ea_version"),
    platformVersion: text("platform_version"),
    mt5BuildVersion: text("mt5_build_version"),

    // Connectivity
    connectivityState: text("connectivity_state"), // "connected" | "reconnecting" | "disconnected"

    // Spread info: { [symbol]: { bid: number, ask: number, spread: number } }
    spreadInfo: jsonb("spread_info").$type<Record<string, unknown>>(),

    // Drawdown
    currentDrawdownPct: real("current_drawdown_pct"),
    peakEquity: real("peak_equity"),
    dailyDrawdownPct: real("daily_drawdown_pct"),
    weeklyDrawdownPct: real("weekly_drawdown_pct"),

    // Execution stats summary
    executionStats: jsonb("execution_stats").$type<Record<string, unknown>>(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ea_telemetry_user_idx").on(t.userId),
    index("ea_telemetry_instance_idx").on(t.eaInstanceId),
    index("ea_telemetry_created_at_idx").on(t.createdAt),
  ],
);

export type EaTelemetrySnapshot = typeof eaTelemetrySnapshotsTable.$inferSelect;

// ─── 2. EA Heartbeat States ───────────────────────────────────────────────────
// One row per EA instance (upserted on each ping). Tracks online/offline state.
// Offline threshold: 120 seconds without a ping.

export const eaHeartbeatStatesTable = pgTable(
  "ea_heartbeat_states",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    eaId: integer("ea_id"),
    eaInstanceId: text("ea_instance_id").notNull(),

    state: text("state", {
      enum: ["ONLINE", "DEGRADED", "OFFLINE", "UNAUTHORIZED", "OUTDATED"],
    })
      .notNull()
      .default("OFFLINE"),

    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastPingAt: timestamp("last_ping_at", { withTimezone: true }),
    offlineSince: timestamp("offline_since", { withTimezone: true }),
    alertSentAt: timestamp("alert_sent_at", { withTimezone: true }),

    eaVersion: text("ea_version"),
    platformVersion: text("platform_version"),
    brokerName: text("broker_name"),
    accountId: text("account_id"),

    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ea_heartbeat_user_idx").on(t.userId),
    index("ea_heartbeat_state_idx").on(t.state),
    // Composite unique: one state row per (user, instance) — prevents cross-tenant collisions
    uniqueIndex("ea_heartbeat_user_instance_uniq").on(t.userId, t.eaInstanceId),
  ],
);

export type EaHeartbeatState = typeof eaHeartbeatStatesTable.$inferSelect;

// ─── 3. EA Execution Quality ──────────────────────────────────────────────────
// Aggregated execution-quality metrics per EA per day. Updated by ingest.

export const eaExecutionQualityTable = pgTable(
  "ea_execution_quality",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    eaId: integer("ea_id"),
    eaInstanceId: text("ea_instance_id"),
    brokerName: text("broker_name"),

    avgSlippagePoints: real("avg_slippage_points"),
    rejectedOrders: integer("rejected_orders").notNull().default(0),
    requotes: integer("requotes").notNull().default(0),
    avgExecutionLatencyMs: real("avg_execution_latency_ms"),
    spreadExpansionPoints: real("spread_expansion_points"),
    /** Composite quality score 0–100 (higher = better). */
    qualityScore: integer("quality_score"),
    sampleCount: integer("sample_count").notNull().default(0),

    /** ISO date string "YYYY-MM-DD" for the aggregation window. */
    periodDate: text("period_date").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ea_exec_quality_user_idx").on(t.userId),
    index("ea_exec_quality_broker_idx").on(t.brokerName),
    index("ea_exec_quality_period_idx").on(t.periodDate),
  ],
);

export type EaExecutionQuality = typeof eaExecutionQualityTable.$inferSelect;

// ─── 4. EA Risk Alerts ────────────────────────────────────────────────────────
// Generated automatically when risk thresholds are breached.

export const eaRiskAlertsTable = pgTable(
  "ea_risk_alerts",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    eaId: integer("ea_id"),
    eaInstanceId: text("ea_instance_id"),

    alertType: text("alert_type", {
      enum: [
        "daily_drawdown",
        "weekly_drawdown",
        "margin_stress",
        "exposure_concentration",
        "abnormal_frequency",
      ],
    }).notNull(),
    severity: text("severity", { enum: ["warning", "critical"] }).notNull(),

    currentValue: real("current_value"),
    thresholdValue: real("threshold_value"),
    message: text("message").notNull(),

    acknowledged: boolean("acknowledged").notNull().default(false),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ea_risk_alerts_user_idx").on(t.userId),
    index("ea_risk_alerts_type_idx").on(t.alertType),
  ],
);

export type EaRiskAlert = typeof eaRiskAlertsTable.$inferSelect;

// ─── 5. Operational Incidents ─────────────────────────────────────────────────
// Admin-managed incident tracking. Separate from the public platform-status
// incidents (status.ts). These are internal operational events.

export const operationalIncidentsTable = pgTable(
  "operational_incidents",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),

    category: text("category", {
      enum: ["BROKER", "EA", "SERVER", "PAYMENT", "MODEL", "NETWORK"],
    }).notNull(),
    status: text("status", {
      enum: ["INCIDENT_OPEN", "INVESTIGATING", "RESOLVED"],
    })
      .notNull()
      .default("INCIDENT_OPEN"),
    severity: text("severity", {
      enum: ["low", "medium", "high", "critical"],
    }).notNull(),

    affectedUsersCount: integer("affected_users_count").default(0),
    actorUserId: text("actor_user_id").notNull(),

    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("operational_incidents_status_idx").on(t.status),
    index("operational_incidents_category_idx").on(t.category),
  ],
);

export type OperationalIncident = typeof operationalIncidentsTable.$inferSelect;

// ─── 6. Platform Alerts ───────────────────────────────────────────────────────
// System-generated alerts for ops team review and acknowledgement.

export const platformAlertsTable = pgTable(
  "platform_alerts",
  {
    id: serial("id").primaryKey(),

    type: text("type", {
      enum: [
        "ea_offline",
        "high_drawdown",
        "execution_failure",
        "broker_disconnect",
        "stale_feed",
        "server_overload",
        "expired_subscription",
        "risk_threshold",
        "margin_call",
      ],
    }).notNull(),
    severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull(),
    message: text("message").notNull(),

    userId: text("user_id"),      // null = platform-wide
    eaId: integer("ea_id"),
    eaInstanceId: text("ea_instance_id"),

    acknowledged: boolean("acknowledged").notNull().default(false),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by"),

    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("platform_alerts_type_idx").on(t.type),
    index("platform_alerts_ack_idx").on(t.acknowledged),
    index("platform_alerts_user_idx").on(t.userId),
  ],
);

export type PlatformAlert = typeof platformAlertsTable.$inferSelect;
