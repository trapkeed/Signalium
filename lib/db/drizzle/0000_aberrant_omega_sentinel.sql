CREATE TYPE "public"."market_memory_kind" AS ENUM('failed_setup', 'successful_setup', 'regime_transition', 'session_behavior', 'volatility_behavior');--> statement-breakpoint
CREATE TYPE "public"."opportunity_state" AS ENUM('WATCHING', 'BUILDING_CONTEXT', 'PREPARING_ENTRY', 'ENTRY_WINDOW', 'POSITION_ACTIVE', 'MANAGING_POSITION', 'EXIT_PREPARATION', 'EXITED', 'COOLDOWN');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('live', 'historical', 'calendar', 'news', 'sentiment');--> statement-breakpoint
CREATE TYPE "public"."qde_deployment_status" AS ENUM('pending', 'downloading', 'verifying', 'warming', 'active', 'retired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."runpod_pod_status" AS ENUM('pending', 'provisioning', 'running', 'stopped', 'restarting', 'terminating', 'terminated', 'failed');--> statement-breakpoint
CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_monthly" real DEFAULT 0 NOT NULL,
	"features" json DEFAULT '[]'::json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"tier" text DEFAULT 'starter' NOT NULL,
	"max_eas" integer,
	"max_symbols" integer,
	"autonomous_allowed" boolean DEFAULT false NOT NULL,
	"api_access_allowed" boolean DEFAULT true NOT NULL,
	"research_access" boolean DEFAULT true NOT NULL,
	"promo_price_monthly" real,
	"promo_label" text,
	"regional_pricing" json DEFAULT '{}'::json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"paused_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eas" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"platform" text DEFAULT 'both' NOT NULL,
	"required_tier" text DEFAULT 'starter' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"change_log" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ea_id" integer,
	"event_type" text NOT NULL,
	"payload" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"password_hash" text,
	"google_id" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"referral_code" text NOT NULL,
	"preferred_payment_provider_id" integer,
	"onboarding_dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "runtime_status" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"last_heartbeat" timestamp with time zone,
	"active_eas" integer DEFAULT 0 NOT NULL,
	"account_id" text,
	"broker" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_status_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount" real NOT NULL,
	"amount" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"user_id" text NOT NULL,
	"subscription_id" integer,
	"payment_id" integer,
	"plan_id" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount" real NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"reason" text NOT NULL,
	"provider" text,
	"payment_reference" text,
	"pdf_object_path" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "invoices_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "payment_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"config" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_providers_type_unique" UNIQUE("type")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subscription_id" integer,
	"plan_id" integer,
	"provider_id" integer NOT NULL,
	"amount" real NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reference" text,
	"network" text,
	"wallet_address" text,
	"tx_hash" text,
	"confirmations" integer DEFAULT 0 NOT NULL,
	"required_confirmations" integer,
	"external_reference" text,
	"proof_url" text,
	"notes" text,
	"metadata" json DEFAULT '{}'::json NOT NULL,
	"expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"refund_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_events_provider_external_id_unique" UNIQUE("provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "smtp_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 587 NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text DEFAULT 'Signalium' NOT NULL,
	"use_tls" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signing_secret" text,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "ea_registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"hardware_id" text NOT NULL,
	"mt5_account" text,
	"broker_name" text,
	"broker_server" text,
	"terminal_build" text,
	"platform_version" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ea_builds" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"api_key_id" integer NOT NULL,
	"build_id" text NOT NULL,
	"file_name" text NOT NULL,
	"platform" text DEFAULT 'mt5' NOT NULL,
	"platform_version" text DEFAULT 'MT5' NOT NULL,
	"subscription_tier" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb NOT NULL,
	"storage_object_path" text NOT NULL,
	"checksum" text NOT NULL,
	"signature" text,
	"file_size_bytes" integer NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"last_downloaded_at" timestamp with time zone,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "ea_builds_build_id_unique" UNIQUE("build_id")
);
--> statement-breakpoint
CREATE TABLE "ea_build_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"build_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symbol_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"alias" text NOT NULL,
	"symbol_id" integer NOT NULL,
	"source" text DEFAULT 'admin' NOT NULL,
	"broker_id" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "symbol_aliases_alias_unique" UNIQUE("alias")
);
--> statement-breakpoint
CREATE TABLE "symbol_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "symbol_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "symbol_mapping_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"raw_alias" text NOT NULL,
	"broker_id" integer,
	"canonical_symbol_id" integer,
	"mapping_source" text NOT NULL,
	"confidence" text,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symbol_mapping_conflicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"raw_alias" text NOT NULL,
	"broker_id" integer,
	"previous_symbol_id" integer,
	"new_symbol_id" integer,
	"source" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symbol_normalization_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"raw_input" text NOT NULL,
	"resolved_symbol_id" integer,
	"resolved" boolean NOT NULL,
	"source" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symbol_regex_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern" text NOT NULL,
	"symbol_id" integer NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symbols" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_symbol" text NOT NULL,
	"display_name" text NOT NULL,
	"category_id" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "symbols_canonical_symbol_unique" UNIQUE("canonical_symbol")
);
--> statement-breakpoint
CREATE TABLE "ea_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"api_key_id" integer NOT NULL,
	"ea_registration_id" integer NOT NULL,
	"connection_id" text NOT NULL,
	"transport" text DEFAULT 'websocket' NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"api_key_id" integer NOT NULL,
	"ea_registration_id" integer NOT NULL,
	"symbol" text,
	"balance" double precision NOT NULL,
	"equity" double precision NOT NULL,
	"margin" double precision NOT NULL,
	"free_margin" double precision NOT NULL,
	"open_positions" integer DEFAULT 0 NOT NULL,
	"floating_pnl" double precision DEFAULT 0 NOT NULL,
	"entry_price" double precision,
	"current_price" double precision,
	"spread" double precision,
	"swap" double precision,
	"commission" double precision,
	"drawdown" double precision,
	"trade_age_seconds" integer,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trainer_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"api_key_id" integer NOT NULL,
	"ea_registration_id" integer NOT NULL,
	"telemetry_id" integer NOT NULL,
	"symbol" text,
	"action" text NOT NULL,
	"reasoning" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account_security" (
	"user_id" text PRIMARY KEY NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"lock_reason" text,
	"unlock_token_hash" text,
	"unlock_token_expires_at" timestamp with time zone,
	"recent_suspicious_count" integer DEFAULT 0 NOT NULL,
	"last_suspicious_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"clerk_session_id" text NOT NULL,
	"ip_address" text,
	"city" text,
	"country" text,
	"device_type" text,
	"browser_name" text,
	"browser_version" text,
	"is_mobile" boolean DEFAULT false NOT NULL,
	"is_new_device" boolean DEFAULT false NOT NULL,
	"is_suspicious" boolean DEFAULT false NOT NULL,
	"fingerprint" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"title" text,
	"description" text,
	"canonical_url" text,
	"og_title" text,
	"og_description" text,
	"og_image" text,
	"twitter_card" text DEFAULT 'summary_large_image' NOT NULL,
	"twitter_title" text,
	"twitter_description" text,
	"twitter_image" text,
	"structured_data" json,
	"hreflang" json DEFAULT '[]'::json NOT NULL,
	"no_index" boolean DEFAULT false NOT NULL,
	"no_follow" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_redirects" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"status_code" integer DEFAULT 301 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"robots_txt" text DEFAULT 'User-agent: *
Allow: /
' NOT NULL,
	"sitemap_enabled" boolean DEFAULT true NOT NULL,
	"site_url" text,
	"favicon_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"object_path" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"alt_text" text,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"plan_tier" text,
	"show_as_banner" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_banner" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text DEFAULT 'system' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"announcement_id" integer,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_content" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"content" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "contact_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_ticket_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"author_id" text NOT NULL,
	"author_role" text NOT NULL,
	"body" text NOT NULL,
	"attachment_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"assigned_admin_id" text,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_articles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "kb_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "platform_status" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'operational' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"impact" text DEFAULT 'minor' NOT NULL,
	"status" text DEFAULT 'investigating' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_user_id" text NOT NULL,
	"referred_user_id" text NOT NULL,
	"referral_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_uuid" text NOT NULL,
	"sequence_num" integer NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brokers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"website" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brokers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "data_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"api_endpoint" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"fallback_for_provider_id" integer,
	"inference_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_providers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "user_symbols" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_symbols_user_symbol_unique" UNIQUE("user_id","symbol_id")
);
--> statement-breakpoint
CREATE TABLE "user_trading_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"trading_mode" text DEFAULT 'manual' NOT NULL,
	"risk_mode" text DEFAULT 'manual' NOT NULL,
	"last_market_source" text,
	"last_market_source_at" timestamp with time zone,
	"last_market_source_detail" jsonb,
	"risk_params" jsonb,
	"qde_status" text DEFAULT 'stopped' NOT NULL,
	"qde_status_updated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inference_controls" (
	"id" text PRIMARY KEY NOT NULL,
	"inference_enabled" boolean DEFAULT true NOT NULL,
	"autonomous_paused" boolean DEFAULT false NOT NULL,
	"forced_model_version" text,
	"live_provider_id" integer,
	"fallback_provider_id" integer,
	"autonomous_market_priority" jsonb DEFAULT '["EA_FEED","oanda","tiingo"]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "market_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"kind" "market_memory_kind" NOT NULL,
	"description" text NOT NULL,
	"confidence" real,
	"outcome" text,
	"metadata" jsonb,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"state" "opportunity_state" DEFAULT 'WATCHING' NOT NULL,
	"direction" text,
	"confidence" real,
	"entry_price" real,
	"current_price" real,
	"stop_loss" real,
	"take_profit" real,
	"reasoning" text,
	"warnings" text[],
	"risk_signal" text,
	"size_signal" text,
	"entry_urgency" text,
	"exit_horizon" text,
	"related_telemetry_id" integer,
	"related_action_id" integer,
	"metadata" jsonb,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entered_at" timestamp with time zone,
	"exited_at" timestamp with time zone,
	"last_evaluated_at" timestamp with time zone,
	"cooldown_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_capabilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"capability_type" "provider_type" NOT NULL,
	"supported_timeframes" text[],
	"max_history_days" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"key_name" text NOT NULL,
	"key_value" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"is_reachable" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"latency_ms" integer,
	"error_message" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_status_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "provider_symbol_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"provider_symbol" text NOT NULL,
	"canonical_symbol_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counterfactual_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"scenario_type" text NOT NULL,
	"parameter_description" text,
	"baseline_pnl" real,
	"counterfactual_pnl" real,
	"improvement" real,
	"improvement_pct" real,
	"analysis" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_context" (
	"id" serial PRIMARY KEY NOT NULL,
	"decision_id" integer NOT NULL,
	"balance" real,
	"equity" real,
	"margin" real,
	"free_margin" real,
	"open_positions" integer,
	"floating_pnl" real,
	"entry_price" real,
	"current_price" real,
	"spread" real,
	"drawdown" real,
	"trade_age_seconds" integer,
	"trend_strength" real,
	"volatility" real,
	"market_quality" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_reasoning" (
	"id" serial PRIMARY KEY NOT NULL,
	"decision_id" integer NOT NULL,
	"reasoning" text NOT NULL,
	"primary_pattern" text,
	"supporting_factors" text[],
	"contradicting_factors" text[],
	"warnings" text[],
	"raw_model_output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_quality_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"session" text NOT NULL,
	"volatility_state" text NOT NULL,
	"avg_slippage" real,
	"avg_spread" real,
	"avg_commission" real,
	"avg_execution_delay_ms" real,
	"partial_fill_rate" real,
	"requote_rate" real,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"opportunity_id" integer,
	"telemetry_id" integer,
	"requested_entry" real,
	"actual_entry" real,
	"slippage" real,
	"spread" real,
	"commission" real,
	"execution_delay_ms" integer,
	"partial_fill" boolean DEFAULT false NOT NULL,
	"requotes" integer DEFAULT 0 NOT NULL,
	"session" text,
	"volatility_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failure_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern_type" text NOT NULL,
	"symbol" text DEFAULT '*' NOT NULL,
	"session" text DEFAULT '*' NOT NULL,
	"occurrences" integer DEFAULT 0 NOT NULL,
	"avg_loss" real,
	"description" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"candidate_type" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"pnl" real,
	"r_multiple" real,
	"notes" text,
	"processed_by_trainer" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"opportunity_id" integer NOT NULL,
	"mfe" real,
	"mae" real,
	"mfe_r" real,
	"mae_r" real,
	"peak_profit" real,
	"max_drawdown" real,
	"entry_confidence" real,
	"peak_confidence" real,
	"min_confidence" real,
	"confidence_volatility" real,
	"confidence_slope" real,
	"confidence_series" real[],
	"snapshot_count" integer DEFAULT 0 NOT NULL,
	"breakeven_hit_at" timestamp with time zone,
	"scale_in_count" integer DEFAULT 0 NOT NULL,
	"partial_close_count" integer DEFAULT 0 NOT NULL,
	"trailing_efficiency" real,
	"exit_efficiency" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"opportunity_id" integer,
	"telemetry_id" integer,
	"profit" real,
	"drawdown" real,
	"swap" real,
	"commission" real,
	"equity_impact" real,
	"distance_to_stop" real,
	"distance_to_target" real,
	"margin_usage" real,
	"position_age_seconds" integer,
	"confidence" real,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qde_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"model_version" text,
	"symbol" text NOT NULL,
	"user_id" text NOT NULL,
	"opportunity_id" integer,
	"telemetry_id" integer,
	"inference_type" text DEFAULT 'inference' NOT NULL,
	"direction" text,
	"confidence" real,
	"risk_signal" text,
	"size_signal" text,
	"entry_urgency" text,
	"exit_horizon" text,
	"session" text,
	"volatility_state" text,
	"spread_state" text,
	"trainer_online" boolean DEFAULT false NOT NULL,
	"artifact_hash" text,
	"manifest_hash" text,
	"feature_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reasoning_accuracy" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern" text NOT NULL,
	"symbol" text DEFAULT '*' NOT NULL,
	"session" text DEFAULT '*' NOT NULL,
	"total_predictions" integer DEFAULT 0 NOT NULL,
	"correct_predictions" integer DEFAULT 0 NOT NULL,
	"accuracy_rate" real,
	"avg_confidence_when_correct" real,
	"avg_confidence_when_wrong" real,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reasoning_validation" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"opportunity_id" integer NOT NULL,
	"decision_id" integer,
	"initial_reasoning" text,
	"initial_pattern" text,
	"was_correct" boolean,
	"actual_pattern" text,
	"correctness_score" real,
	"validator_note" text,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "self_evaluation_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_type" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"total_trades" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"win_rate" real,
	"avg_r_multiple" real,
	"best_r_multiple" real,
	"worst_r_multiple" real,
	"sharpe_ratio" real,
	"best_symbol" text,
	"worst_symbol" text,
	"best_session" text,
	"worst_session" text,
	"confidence_reliability" real,
	"reasoning_accuracy" real,
	"model_quality_score" real,
	"insights" text[],
	"raw_data" jsonb,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"opportunity_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"confidence" real,
	"price" real,
	"note" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_failures" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"opportunity_id" integer NOT NULL,
	"root_cause" text,
	"warning_signs" text[],
	"confidence_decay_notes" text,
	"late_exit_indicators" text[],
	"position_management_issues" text[],
	"final_loss" real,
	"max_adverse_excursion" real,
	"admin_notes" text,
	"investigated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_timeline" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"opportunity_id" integer NOT NULL,
	"entry_at" timestamp with time zone,
	"exit_at" timestamp with time zone,
	"entry_price" real,
	"exit_price" real,
	"stop_loss" real,
	"take_profit" real,
	"direction" text,
	"final_pnl" real,
	"r_multiple" real,
	"outcome" text,
	"setup_type" text,
	"session" text,
	"model_version" text,
	"total_events" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trainer_sync_state" (
	"id" text PRIMARY KEY NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_message" text,
	"decisions_exported" integer DEFAULT 0 NOT NULL,
	"timelines_exported" integer DEFAULT 0 NOT NULL,
	"executions_exported" integer DEFAULT 0 NOT NULL,
	"candidates_exported" integer DEFAULT 0 NOT NULL,
	"total_syncs" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qde_deployment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" integer,
	"event_type" text NOT NULL,
	"message" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qde_deployment_health" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" integer NOT NULL,
	"latency_p50_ms" real,
	"latency_p95_ms" real,
	"latency_p99_ms" real,
	"error_rate" real,
	"throughput_per_min" real,
	"memory_usage_mb" real,
	"cpu_usage_pct" real,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"confidence_distribution" jsonb,
	"alerts" text[],
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qde_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"version" text NOT NULL,
	"status" "qde_deployment_status" DEFAULT 'pending' NOT NULL,
	"artifact_hash" text,
	"manifest_hash" text,
	"feature_version" text,
	"manifest_data" jsonb,
	"local_cache_path" text,
	"trainer_url" text,
	"integrity_verified" boolean DEFAULT false NOT NULL,
	"warmup_latency_ms" real,
	"failure_reason" text,
	"metadata" jsonb,
	"downloaded_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"warmed_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_channel_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"email_recipients" text[] DEFAULT '{}' NOT NULL,
	"telegram_enabled" boolean DEFAULT true NOT NULL,
	"discord_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_delivery_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" integer NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ea_execution_quality" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ea_id" integer,
	"ea_instance_id" text,
	"broker_name" text,
	"avg_slippage_points" real,
	"rejected_orders" integer DEFAULT 0 NOT NULL,
	"requotes" integer DEFAULT 0 NOT NULL,
	"avg_execution_latency_ms" real,
	"spread_expansion_points" real,
	"quality_score" integer,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"period_date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ea_heartbeat_states" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ea_id" integer,
	"ea_instance_id" text NOT NULL,
	"state" text DEFAULT 'OFFLINE' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_ping_at" timestamp with time zone,
	"offline_since" timestamp with time zone,
	"alert_sent_at" timestamp with time zone,
	"ea_version" text,
	"platform_version" text,
	"broker_name" text,
	"account_id" text,
	"metadata" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ea_risk_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ea_id" integer,
	"ea_instance_id" text,
	"alert_type" text NOT NULL,
	"severity" text NOT NULL,
	"current_value" real,
	"threshold_value" real,
	"message" text NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ea_symbol_ticks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ea_instance_id" text NOT NULL,
	"broker_symbol" text NOT NULL,
	"normalized_symbol" text,
	"bid" real,
	"ask" real,
	"spread" real,
	"tick_volume" integer,
	"tick_timestamp" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ea_telemetry_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ea_id" integer,
	"account_id" text,
	"ea_instance_id" text,
	"equity" real,
	"balance" real,
	"floating_pnl" real,
	"margin_level" real,
	"free_margin" real,
	"open_positions_count" integer,
	"active_symbols" text[],
	"broker_name" text,
	"broker_server" text,
	"broker_company" text,
	"broker_symbol" text,
	"leverage" integer,
	"account_currency" text,
	"tick_timestamp" timestamp with time zone,
	"vps_latency_ms" integer,
	"ea_version" text,
	"platform_version" text,
	"mt5_build_version" text,
	"connectivity_state" text,
	"spread_info" jsonb,
	"current_drawdown_pct" real,
	"peak_equity" real,
	"daily_drawdown_pct" real,
	"weekly_drawdown_pct" real,
	"execution_stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"status" text DEFAULT 'INCIDENT_OPEN' NOT NULL,
	"severity" text NOT NULL,
	"affected_users_count" integer DEFAULT 0,
	"actor_user_id" text NOT NULL,
	"metadata" jsonb,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"user_id" text,
	"ea_id" integer,
	"ea_instance_id" text,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_health_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"cpu_usage_pct" real,
	"memory_usage_mb" real,
	"memory_total_mb" real,
	"event_loop_lag_ms" real,
	"db_latency_ms" real,
	"db_healthy" boolean DEFAULT true NOT NULL,
	"redis_latency_ms" real,
	"redis_configured" boolean DEFAULT false NOT NULL,
	"active_websocket_connections" integer DEFAULT 0 NOT NULL,
	"scheduler_last_run_at" timestamp with time zone,
	"worker_healthy" boolean DEFAULT true NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"version" text NOT NULL,
	"git_commit_hash" text,
	"notes" text,
	"deployed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"user_id" text,
	"ip_address" text,
	"api_key_id" integer,
	"scope_key" text,
	"message" text NOT NULL,
	"detail" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_role_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assumptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"assumed_role" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sso_refresh_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"audience" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_token_id" integer,
	CONSTRAINT "sso_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sso_signing_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"kid" text NOT NULL,
	"private_key_pem" text NOT NULL,
	"public_key_jwk" text NOT NULL,
	"is_active" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sso_signing_keys_kid_unique" UNIQUE("kid")
);
--> statement-breakpoint
CREATE TABLE "backup_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"backup_type" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"object_path" text,
	"size_bytes" bigint,
	"checksum_sha256" text,
	"triggered_by" text,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"validated_at" timestamp,
	"retention_expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "job_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"queue_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_error" text,
	"locked_by" text,
	"locked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "secret_rotation" (
	"id" serial PRIMARY KEY NOT NULL,
	"secret_name" text NOT NULL,
	"category" text NOT NULL,
	"rotation_interval_days" integer DEFAULT 90 NOT NULL,
	"last_rotated_at" timestamp,
	"last_rotated_by" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "secret_rotation_secret_name_unique" UNIQUE("secret_name")
);
--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending_confirmation' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"scheduled_for" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"consent_type" text NOT NULL,
	"version" text NOT NULL,
	"granted" boolean NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_export_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"payload_hash" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_action_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_type" text NOT NULL,
	"requested_by" text NOT NULL,
	"target_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_session_activity" (
	"clerk_session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_blocklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip_address" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ip_blocklist_ip_address_unique" UNIQUE("ip_address")
);
--> statement-breakpoint
CREATE TABLE "admin_secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"encrypted_value" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"rotated_at" timestamp with time zone,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_secrets_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "email_auth_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"pending_password_hash" text,
	"pending_first_name" text,
	"pending_last_name" text,
	"pending_referral_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_credentials" (
	"provider" text PRIMARY KEY NOT NULL,
	"encrypted_client_id" text NOT NULL,
	"encrypted_client_secret" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "runpod_pods" (
	"id" serial PRIMARY KEY NOT NULL,
	"runpod_pod_id" text,
	"name" text NOT NULL,
	"gpu_type" text NOT NULL,
	"template_id" text,
	"volume_id" text,
	"region" text,
	"status" "runpod_pod_status" DEFAULT 'pending' NOT NULL,
	"cost_per_hr_usd" real,
	"last_reported_cost_per_hr_usd" real,
	"accrued_cost_usd" real DEFAULT 0 NOT NULL,
	"last_utilization_pct" real,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"launched_by" text NOT NULL,
	"launched_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"terminated_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runpod_worker_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"pod_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scope_label" text,
	"issued_by" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"rotated_from_id" integer
);
--> statement-breakpoint
CREATE TABLE "trainer_sync_probes" (
	"id" serial PRIMARY KEY NOT NULL,
	"reachable" boolean NOT NULL,
	"latency_ms" integer,
	"error" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_id_payment_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."payment_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ea_registrations" ADD CONSTRAINT "ea_registrations_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ea_builds" ADD CONSTRAINT "ea_builds_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ea_build_audit_log" ADD CONSTRAINT "ea_build_audit_log_build_id_ea_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."ea_builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_aliases" ADD CONSTRAINT "symbol_aliases_symbol_id_symbols_id_fk" FOREIGN KEY ("symbol_id") REFERENCES "public"."symbols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_aliases" ADD CONSTRAINT "symbol_aliases_broker_id_brokers_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."brokers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_mapping_cache" ADD CONSTRAINT "symbol_mapping_cache_broker_id_brokers_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."brokers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_mapping_cache" ADD CONSTRAINT "symbol_mapping_cache_canonical_symbol_id_symbols_id_fk" FOREIGN KEY ("canonical_symbol_id") REFERENCES "public"."symbols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_mapping_conflicts" ADD CONSTRAINT "symbol_mapping_conflicts_broker_id_brokers_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."brokers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_mapping_conflicts" ADD CONSTRAINT "symbol_mapping_conflicts_previous_symbol_id_symbols_id_fk" FOREIGN KEY ("previous_symbol_id") REFERENCES "public"."symbols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_mapping_conflicts" ADD CONSTRAINT "symbol_mapping_conflicts_new_symbol_id_symbols_id_fk" FOREIGN KEY ("new_symbol_id") REFERENCES "public"."symbols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_normalization_log" ADD CONSTRAINT "symbol_normalization_log_resolved_symbol_id_symbols_id_fk" FOREIGN KEY ("resolved_symbol_id") REFERENCES "public"."symbols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_regex_patterns" ADD CONSTRAINT "symbol_regex_patterns_symbol_id_symbols_id_fk" FOREIGN KEY ("symbol_id") REFERENCES "public"."symbols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbols" ADD CONSTRAINT "symbols_category_id_symbol_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."symbol_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ea_connections" ADD CONSTRAINT "ea_connections_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ea_connections" ADD CONSTRAINT "ea_connections_ea_registration_id_ea_registrations_id_fk" FOREIGN KEY ("ea_registration_id") REFERENCES "public"."ea_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_telemetry" ADD CONSTRAINT "position_telemetry_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_telemetry" ADD CONSTRAINT "position_telemetry_ea_registration_id_ea_registrations_id_fk" FOREIGN KEY ("ea_registration_id") REFERENCES "public"."ea_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_actions" ADD CONSTRAINT "trainer_actions_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_actions" ADD CONSTRAINT "trainer_actions_ea_registration_id_ea_registrations_id_fk" FOREIGN KEY ("ea_registration_id") REFERENCES "public"."ea_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_actions" ADD CONSTRAINT "trainer_actions_telemetry_id_position_telemetry_id_fk" FOREIGN KEY ("telemetry_id") REFERENCES "public"."position_telemetry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_symbols" ADD CONSTRAINT "user_symbols_symbol_id_symbols_id_fk" FOREIGN KEY ("symbol_id") REFERENCES "public"."symbols"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_controls" ADD CONSTRAINT "inference_controls_live_provider_id_data_providers_id_fk" FOREIGN KEY ("live_provider_id") REFERENCES "public"."data_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_controls" ADD CONSTRAINT "inference_controls_fallback_provider_id_data_providers_id_fk" FOREIGN KEY ("fallback_provider_id") REFERENCES "public"."data_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_capabilities" ADD CONSTRAINT "provider_capabilities_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_status" ADD CONSTRAINT "provider_status_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_symbol_mappings" ADD CONSTRAINT "provider_symbol_mappings_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_symbol_mappings" ADD CONSTRAINT "provider_symbol_mappings_canonical_symbol_id_symbols_id_fk" FOREIGN KEY ("canonical_symbol_id") REFERENCES "public"."symbols"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counterfactual_results" ADD CONSTRAINT "counterfactual_results_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_context" ADD CONSTRAINT "decision_context_decision_id_qde_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."qde_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_reasoning" ADD CONSTRAINT "decision_reasoning_decision_id_qde_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."qde_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_telemetry" ADD CONSTRAINT "execution_telemetry_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_telemetry" ADD CONSTRAINT "execution_telemetry_telemetry_id_position_telemetry_id_fk" FOREIGN KEY ("telemetry_id") REFERENCES "public"."position_telemetry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_candidates" ADD CONSTRAINT "learning_candidates_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_metrics" ADD CONSTRAINT "position_metrics_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_telemetry_id_position_telemetry_id_fk" FOREIGN KEY ("telemetry_id") REFERENCES "public"."position_telemetry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qde_decisions" ADD CONSTRAINT "qde_decisions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qde_decisions" ADD CONSTRAINT "qde_decisions_telemetry_id_position_telemetry_id_fk" FOREIGN KEY ("telemetry_id") REFERENCES "public"."position_telemetry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reasoning_validation" ADD CONSTRAINT "reasoning_validation_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reasoning_validation" ADD CONSTRAINT "reasoning_validation_decision_id_qde_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."qde_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_events_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_failures" ADD CONSTRAINT "trade_failures_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_timeline" ADD CONSTRAINT "trade_timeline_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qde_deployment_events" ADD CONSTRAINT "qde_deployment_events_deployment_id_qde_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."qde_deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qde_deployment_health" ADD CONSTRAINT "qde_deployment_health_deployment_id_qde_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."qde_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_delivery_log" ADD CONSTRAINT "alert_delivery_log_alert_id_platform_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."platform_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runpod_worker_credentials" ADD CONSTRAINT "runpod_worker_credentials_pod_id_runpod_pods_id_fk" FOREIGN KEY ("pod_id") REFERENCES "public"."runpod_pods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ea_registrations_api_key_hardware_idx" ON "ea_registrations" USING btree ("api_key_id","hardware_id");--> statement-breakpoint
CREATE INDEX "ea_connections_ea_registration_idx" ON "ea_connections" USING btree ("ea_registration_id");--> statement-breakpoint
CREATE INDEX "ea_connections_status_idx" ON "ea_connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "position_telemetry_user_idx" ON "position_telemetry" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "position_telemetry_ea_registration_idx" ON "position_telemetry" USING btree ("ea_registration_id");--> statement-breakpoint
CREATE INDEX "position_telemetry_received_at_idx" ON "position_telemetry" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "trainer_actions_ea_registration_idx" ON "trainer_actions" USING btree ("ea_registration_id");--> statement-breakpoint
CREATE INDEX "trainer_actions_status_idx" ON "trainer_actions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "login_events_session_idx" ON "login_events" USING btree ("clerk_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_pages_path_idx" ON "seo_pages" USING btree ("path");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_redirects_from_path_idx" ON "seo_redirects" USING btree ("from_path");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_ticket_replies_ticket_id_idx" ON "support_ticket_replies" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "support_tickets_user_id_idx" ON "support_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_tickets_assigned_admin_id_idx" ON "support_tickets" USING btree ("assigned_admin_id");--> statement-breakpoint
CREATE INDEX "kb_articles_category_id_idx" ON "kb_articles" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referred_user_idx" ON "referrals" USING btree ("referred_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_event_uuid_idx" ON "audit_log" USING btree ("event_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_sequence_num_idx" ON "audit_log" USING btree ("sequence_num");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_capability_unique" ON "provider_capabilities" USING btree ("provider_id","capability_type");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_symbol_unique" ON "provider_symbol_mappings" USING btree ("provider_id","provider_symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "counterfactual_opportunity_scenario_unique" ON "counterfactual_results" USING btree ("opportunity_id","scenario_type");--> statement-breakpoint
CREATE INDEX "counterfactual_user_idx" ON "counterfactual_results" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_quality_segment_unique" ON "execution_quality_metrics" USING btree ("symbol","session","volatility_state");--> statement-breakpoint
CREATE INDEX "execution_telemetry_user_idx" ON "execution_telemetry" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "execution_telemetry_symbol_idx" ON "execution_telemetry" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "execution_telemetry_created_at_idx" ON "execution_telemetry" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "failure_patterns_segment_unique" ON "failure_patterns" USING btree ("pattern_type","symbol","session");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_candidates_opportunity_type_unique" ON "learning_candidates" USING btree ("opportunity_id","candidate_type");--> statement-breakpoint
CREATE INDEX "learning_candidates_priority_idx" ON "learning_candidates" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "learning_candidates_processed_idx" ON "learning_candidates" USING btree ("processed_by_trainer");--> statement-breakpoint
CREATE UNIQUE INDEX "position_metrics_opportunity_unique" ON "position_metrics" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "position_snapshots_opportunity_idx" ON "position_snapshots" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "position_snapshots_user_idx" ON "position_snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "position_snapshots_snapshot_at_idx" ON "position_snapshots" USING btree ("snapshot_at");--> statement-breakpoint
CREATE INDEX "qde_decisions_user_idx" ON "qde_decisions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "qde_decisions_symbol_idx" ON "qde_decisions" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "qde_decisions_opportunity_idx" ON "qde_decisions" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "qde_decisions_created_at_idx" ON "qde_decisions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reasoning_accuracy_segment_unique" ON "reasoning_accuracy" USING btree ("pattern","symbol","session");--> statement-breakpoint
CREATE UNIQUE INDEX "reasoning_validation_opportunity_unique" ON "reasoning_validation" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "self_eval_reports_type_period_idx" ON "self_evaluation_reports" USING btree ("report_type","period_end");--> statement-breakpoint
CREATE INDEX "trade_events_opportunity_idx" ON "trade_events" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "trade_events_occurred_at_idx" ON "trade_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_failures_opportunity_unique" ON "trade_failures" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "trade_failures_symbol_idx" ON "trade_failures" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_timeline_opportunity_unique" ON "trade_timeline" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "trade_timeline_user_idx" ON "trade_timeline" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trade_timeline_symbol_idx" ON "trade_timeline" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "trade_timeline_exit_at_idx" ON "trade_timeline" USING btree ("exit_at");--> statement-breakpoint
CREATE INDEX "qde_deployment_events_deployment_idx" ON "qde_deployment_events" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "qde_deployment_events_occurred_at_idx" ON "qde_deployment_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "qde_deployment_events_type_idx" ON "qde_deployment_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "qde_deployment_health_deployment_idx" ON "qde_deployment_health" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "qde_deployment_health_recorded_at_idx" ON "qde_deployment_health" USING btree ("recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "qde_deployments_deployment_id_idx" ON "qde_deployments" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "qde_deployments_status_idx" ON "qde_deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "qde_deployments_version_idx" ON "qde_deployments" USING btree ("version");--> statement-breakpoint
CREATE INDEX "qde_deployments_created_at_idx" ON "qde_deployments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "alert_delivery_log_alert_idx" ON "alert_delivery_log" USING btree ("alert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_delivery_log_alert_channel_uniq" ON "alert_delivery_log" USING btree ("alert_id","channel");--> statement-breakpoint
CREATE INDEX "ea_exec_quality_user_idx" ON "ea_execution_quality" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ea_exec_quality_broker_idx" ON "ea_execution_quality" USING btree ("broker_name");--> statement-breakpoint
CREATE INDEX "ea_exec_quality_period_idx" ON "ea_execution_quality" USING btree ("period_date");--> statement-breakpoint
CREATE INDEX "ea_heartbeat_user_idx" ON "ea_heartbeat_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ea_heartbeat_state_idx" ON "ea_heartbeat_states" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "ea_heartbeat_user_instance_uniq" ON "ea_heartbeat_states" USING btree ("user_id","ea_instance_id");--> statement-breakpoint
CREATE INDEX "ea_risk_alerts_user_idx" ON "ea_risk_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ea_risk_alerts_type_idx" ON "ea_risk_alerts" USING btree ("alert_type");--> statement-breakpoint
CREATE UNIQUE INDEX "ea_symbol_ticks_instance_symbol_idx" ON "ea_symbol_ticks" USING btree ("ea_instance_id","broker_symbol");--> statement-breakpoint
CREATE INDEX "ea_symbol_ticks_user_idx" ON "ea_symbol_ticks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ea_telemetry_user_idx" ON "ea_telemetry_snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ea_telemetry_instance_idx" ON "ea_telemetry_snapshots" USING btree ("ea_instance_id");--> statement-breakpoint
CREATE INDEX "ea_telemetry_created_at_idx" ON "ea_telemetry_snapshots" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "operational_incidents_status_idx" ON "operational_incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "operational_incidents_category_idx" ON "operational_incidents" USING btree ("category");--> statement-breakpoint
CREATE INDEX "platform_alerts_type_idx" ON "platform_alerts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "platform_alerts_ack_idx" ON "platform_alerts" USING btree ("acknowledged");--> statement-breakpoint
CREATE INDEX "platform_alerts_user_idx" ON "platform_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_health_recorded_at_idx" ON "platform_health_snapshots" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "service_deployments_service_idx" ON "service_deployments" USING btree ("service");--> statement-breakpoint
CREATE INDEX "service_deployments_deployed_at_idx" ON "service_deployments" USING btree ("deployed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_role_assignments_user_role_idx" ON "admin_role_assignments" USING btree ("user_id","role");--> statement-breakpoint
CREATE INDEX "backup_records_started_at_idx" ON "backup_records" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "backup_records_status_idx" ON "backup_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "job_queue_dispatch_idx" ON "job_queue" USING btree ("status","priority","next_attempt_at");--> statement-breakpoint
CREATE INDEX "job_queue_queue_name_idx" ON "job_queue" USING btree ("queue_name");--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_requests_one_active_idx" ON "account_deletion_requests" USING btree ("user_id") WHERE "account_deletion_requests"."status" in ('pending_confirmation', 'scheduled');--> statement-breakpoint
CREATE INDEX "account_deletion_requests_user_idx" ON "account_deletion_requests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_records_user_type_idx" ON "consent_records" USING btree ("user_id","consent_type");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_action_approvals_active_idx" ON "admin_action_approvals" USING btree ("action_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_credentials_provider_idx" ON "oauth_credentials" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "runpod_pods_runpod_pod_id_idx" ON "runpod_pods" USING btree ("runpod_pod_id");--> statement-breakpoint
CREATE INDEX "runpod_pods_status_idx" ON "runpod_pods" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "runpod_worker_credentials_token_hash_idx" ON "runpod_worker_credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "runpod_worker_credentials_pod_idx" ON "runpod_worker_credentials" USING btree ("pod_id");--> statement-breakpoint
CREATE INDEX "runpod_worker_credentials_expires_at_idx" ON "runpod_worker_credentials" USING btree ("expires_at");