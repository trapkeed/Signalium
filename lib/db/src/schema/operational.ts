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
        // S23b additions
        "trainer_unavailable",
        "inference_failure",
        "excessive_latency",
        "database_failure",
        "payment_failure",
        "data_provider_outage",
        "abnormal_market_condition",
        // S25 additions
        "autonomous_trading_anomaly",
        "excessive_drawdown_cluster",
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

// ─── 7. Platform Health Snapshots ─────────────────────────────────────────────
// S23a — periodic system-level health samples for the API server process.
// Collected in-memory and flushed on an interval, following the same
// snapshot-then-reset pattern as qdeDeploymentHealthTable.

export const platformHealthSnapshotsTable = pgTable(
  "platform_health_snapshots",
  {
    id: serial("id").primaryKey(),

    cpuUsagePct: real("cpu_usage_pct"),
    memoryUsageMb: real("memory_usage_mb"),
    memoryTotalMb: real("memory_total_mb"),
    eventLoopLagMs: real("event_loop_lag_ms"),

    dbLatencyMs: real("db_latency_ms"),
    dbHealthy: boolean("db_healthy").notNull().default(true),

    /** Null when no Redis/queue infra is configured on the platform. */
    redisLatencyMs: real("redis_latency_ms"),
    redisConfigured: boolean("redis_configured").notNull().default(false),

    activeWebsocketConnections: integer("active_websocket_connections").notNull().default(0),

    /** Last time the deployment-poll / health-flush background scheduler ran. */
    schedulerLastRunAt: timestamp("scheduler_last_run_at", { withTimezone: true }),
    workerHealthy: boolean("worker_healthy").notNull().default(true),

    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("platform_health_recorded_at_idx").on(t.recordedAt)],
);

export type PlatformHealthSnapshot = typeof platformHealthSnapshotsTable.$inferSelect;

// ─── 8. Service Deployments ───────────────────────────────────────────────────
// S23a — version + git-commit tracking for each platform service (frontend,
// backend/API, trainer). Separate from qdeDeploymentsTable, which tracks the
// QDE model itself. One row per recorded deployment event per service —
// the most recent row per service is the "current" version; older rows are
// the rollback-reference history.

export const serviceDeploymentsTable = pgTable(
  "service_deployments",
  {
    id: serial("id").primaryKey(),
    service: text("service", {
      enum: ["frontend", "backend", "trainer"],
    }).notNull(),
    version: text("version").notNull(),
    gitCommitHash: text("git_commit_hash"),
    notes: text("notes"),
    deployedAt: timestamp("deployed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("service_deployments_service_idx").on(t.service),
    index("service_deployments_deployed_at_idx").on(t.deployedAt),
  ],
);

export type ServiceDeployment = typeof serviceDeploymentsTable.$inferSelect;

// ─── 9. Alert Delivery Log ─────────────────────────────────────────────────
// S23b — one row per (alert, channel) delivery attempt. Lets the Alerts admin
// page show per-channel delivery status without overloading platformAlertsTable.

export const alertDeliveryLogTable = pgTable(
  "alert_delivery_log",
  {
    id: serial("id").primaryKey(),
    alertId: integer("alert_id")
      .notNull()
      .references(() => platformAlertsTable.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["email", "telegram", "discord"] }).notNull(),
    status: text("status", {
      enum: ["sent", "failed", "skipped", "not_configured"],
    }).notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("alert_delivery_log_alert_idx").on(t.alertId),
    uniqueIndex("alert_delivery_log_alert_channel_uniq").on(t.alertId, t.channel),
  ],
);

export type AlertDeliveryLog = typeof alertDeliveryLogTable.$inferSelect;

// ─── 10. Alert Channel Settings ───────────────────────────────────────────────
// S23b — singleton row (id = "global") toggling which delivery channels are
// active. Credentials themselves (SMTP, Telegram bot token, Discord webhook)
// live in smtp_settings / environment secrets, never in this table.

export const alertChannelSettingsTable = pgTable("alert_channel_settings", {
  id: text("id").primaryKey(), // always "global"
  emailEnabled: boolean("email_enabled").notNull().default(true),
  emailRecipients: text("email_recipients").array().notNull().default([]),
  telegramEnabled: boolean("telegram_enabled").notNull().default(true),
  discordEnabled: boolean("discord_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AlertChannelSettings = typeof alertChannelSettingsTable.$inferSelect;
