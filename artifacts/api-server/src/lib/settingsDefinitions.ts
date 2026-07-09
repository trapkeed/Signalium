/**
 * Structured catalog of every known config domain/key the platform reads,
 * spanning both admin-managed vault secrets (`admin_secrets`) and
 * process.env-backed system secrets. This is the single source of truth
 * that:
 *  - drives the "System Settings" consolidated admin page (grouped by
 *    category, configured/not-configured badges),
 *  - flags which keys are `trainerRelevant` so the sync-status
 *    config-version hash only covers non-secret trainer-facing config,
 *  - keeps the quick-add catalog on the Secrets Vault page in one place.
 *
 * Adding a new config key/category should only ever require adding an
 * entry here — never a schema migration (see SETTINGS_CATEGORIES).
 */
import { SETTINGS_CATEGORIES, type SettingsCategory } from "@workspace/db";

export type SettingsSource = "vault" | "env";

export interface SettingsDefinition {
  key: string;
  category: SettingsCategory;
  description: string;
  source: SettingsSource;
  /** process.env fallback name, if this key is also readable from env. */
  envVarName?: string;
  /** True if this key affects what the trainer/inference gateway does — used to compute the sync-status config-version hash. Never true for secret values. */
  trainerRelevant?: boolean;
  /** Admin page to link to for editing this key. */
  managePath: string;
}

export const SETTINGS_DEFINITIONS: SettingsDefinition[] = [
  // ─── Auth / SSO ───────────────────────────────────────────────────────
  { key: "sso.issuer", category: "auth", description: "JWT issuer claim for Signalium-issued SSO tokens.", source: "vault", envVarName: "JWT_ISSUER", trainerRelevant: true, managePath: "/admin/secrets" },
  { key: "sso.access_token_ttl_seconds", category: "auth", description: "SSO access token lifetime in seconds.", source: "vault", envVarName: "JWT_EXPIRATION", trainerRelevant: true, managePath: "/admin/secrets" },
  { key: "sso.refresh_token_ttl_days", category: "auth", description: "SSO refresh token lifetime in days.", source: "vault", envVarName: "JWT_REFRESH_EXPIRATION", managePath: "/admin/secrets" },
  { key: "SESSION_SECRET", category: "auth", description: "Signs sessions, tokens, and encrypts admin secrets.", source: "env", managePath: "/admin/secrets" },
  { key: "google_oauth", category: "auth", description: "Google OAuth client id/secret for \"Continue with Google\".", source: "vault", managePath: "/admin/secrets" },

  // ─── Payments ─────────────────────────────────────────────────────────
  { key: "payments.stripe_secret_key", category: "payments", description: "Stripe secret key.", source: "vault", envVarName: "STRIPE_SECRET_KEY", managePath: "/admin/secrets" },
  { key: "payments.stripe_webhook_secret", category: "payments", description: "Stripe webhook signing secret.", source: "vault", envVarName: "STRIPE_WEBHOOK_SECRET", managePath: "/admin/secrets" },
  { key: "payments.paypal_client_id", category: "payments", description: "PayPal REST client id.", source: "vault", envVarName: "PAYPAL_CLIENT_ID", managePath: "/admin/secrets" },
  { key: "payments.paypal_client_secret", category: "payments", description: "PayPal REST client secret.", source: "vault", envVarName: "PAYPAL_CLIENT_SECRET", managePath: "/admin/secrets" },
  { key: "payments.paypal_webhook_id", category: "payments", description: "PayPal webhook resource id.", source: "vault", envVarName: "PAYPAL_WEBHOOK_ID", managePath: "/admin/secrets" },
  { key: "payments.nowpayments_api_key", category: "payments", description: "NOWPayments API key.", source: "vault", managePath: "/admin/secrets" },
  { key: "payments.nowpayments_ipn_secret", category: "payments", description: "NOWPayments IPN callback signing secret.", source: "vault", managePath: "/admin/secrets" },

  // ─── Email ────────────────────────────────────────────────────────────
  { key: "smtp.config", category: "email", description: "Active SMTP delivery configuration.", source: "vault", managePath: "/admin/smtp" },

  // ─── Infra ────────────────────────────────────────────────────────────
  { key: "DATABASE_URL", category: "infra", description: "PostgreSQL connection string.", source: "env", managePath: "/admin/secrets" },
  { key: "PRIVATE_OBJECT_DIR", category: "infra", description: "Private object storage bucket path for EA builds/exports.", source: "env", managePath: "/admin/secrets" },
  { key: "SECRETS_ENCRYPTION_KEY", category: "infra", description: "Optional dedicated key for the admin secrets vault (falls back to SESSION_SECRET).", source: "env", managePath: "/admin/secrets" },

  // ─── AI ───────────────────────────────────────────────────────────────
  { key: "openai.api_key", category: "ai", description: "OpenAI API key.", source: "vault", managePath: "/admin/secrets" },
  { key: "openai.model", category: "ai", description: "Default OpenAI model name.", source: "vault", trainerRelevant: true, managePath: "/admin/secrets" },

  // ─── Trainer ──────────────────────────────────────────────────────────
  { key: "trainer.url", category: "trainer", description: "Base URL of the signalium-trainer service (inference, training, Research Lab).", source: "vault", envVarName: "QDE_TRAINER_URL", trainerRelevant: true, managePath: "/admin/secrets" },
  { key: "trainer.api_key", category: "trainer", description: "Optional trainer-side API key, additive to the signed SSO service token.", source: "vault", envVarName: "QDE_TRAINER_API_KEY", managePath: "/admin/secrets" },
  { key: "trainer.timeout_ms", category: "trainer", description: "Request timeout (ms) for outbound trainer calls.", source: "vault", trainerRelevant: true, managePath: "/admin/secrets" },
  { key: "trainer.retry_count", category: "trainer", description: "Retry attempts for outbound trainer calls.", source: "vault", trainerRelevant: true, managePath: "/admin/secrets" },
  { key: "trainer.circuit_breaker_threshold", category: "trainer", description: "Consecutive failures before the trainer circuit breaker opens.", source: "vault", trainerRelevant: true, managePath: "/admin/secrets" },
  { key: "trainer.circuit_breaker_reset_ms", category: "trainer", description: "Cooldown (ms) before the trainer circuit breaker retries after opening.", source: "vault", trainerRelevant: true, managePath: "/admin/secrets" },
  { key: "QDE_RESEARCH_LAB_URL", category: "trainer", description: "Base URL of the Research Lab integration hub (falls back if trainer.url unset).", source: "env", trainerRelevant: true, managePath: "/admin/secrets" },

  // ─── Market data ──────────────────────────────────────────────────────
  { key: "market_data.tiingo_api_key", category: "market_data", description: "Tiingo market data API key.", source: "vault", managePath: "/admin/data-providers" },
  { key: "market_data.oanda_api_key", category: "market_data", description: "OANDA API key.", source: "vault", managePath: "/admin/data-providers" },
  { key: "market_data.twelvedata_api_key", category: "market_data", description: "Twelve Data API key.", source: "vault", managePath: "/admin/data-providers" },
  { key: "market_data.polygon_api_key", category: "market_data", description: "Polygon.io API key.", source: "vault", managePath: "/admin/data-providers" },
  { key: "market_data.finnhub_api_key", category: "market_data", description: "Finnhub API key.", source: "vault", managePath: "/admin/data-providers" },

  // ─── RunPod ───────────────────────────────────────────────────────────
  { key: "runpod.api_key", category: "runpod", description: "RunPod API key for GPU training infrastructure.", source: "vault", managePath: "/admin/runpod" },
  { key: "runpod.endpoint_id", category: "runpod", description: "RunPod serverless endpoint id.", source: "vault", managePath: "/admin/runpod" },
  { key: "runpod.gpu_template", category: "runpod", description: "RunPod GPU pod template id.", source: "vault", managePath: "/admin/runpod" },
  { key: "runpod.volume_id", category: "runpod", description: "RunPod persistent volume id.", source: "vault", managePath: "/admin/runpod" },

  // ─── EA feed ──────────────────────────────────────────────────────────
  { key: "ea_feed.symbols", category: "ea_feed", description: "Data providers / symbol mappings driving the EA telemetry feed.", source: "vault", managePath: "/admin/data-providers" },
];

export function getSettingsCategories(): readonly SettingsCategory[] {
  return SETTINGS_CATEGORIES;
}

export function getDefinitionsByCategory(): Record<string, SettingsDefinition[]> {
  const grouped: Record<string, SettingsDefinition[]> = {};
  for (const cat of SETTINGS_CATEGORIES) grouped[cat] = [];
  for (const def of SETTINGS_DEFINITIONS) {
    (grouped[def.category] ??= []).push(def);
  }
  return grouped;
}

export function getTrainerRelevantKeys(): string[] {
  return SETTINGS_DEFINITIONS.filter((d) => d.trainerRelevant).map((d) => d.key);
}
