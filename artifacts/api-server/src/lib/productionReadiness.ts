/**
 * S30 — Production Readiness aggregator.
 *
 * Every check here is read-only / non-mutating: it inspects configuration
 * and, where a lightweight provider-native probe exists, calls it — it never
 * sends a real email, charges a card, or triggers a real trade. The goal is
 * "can this dependency be reached with the credentials we have", not
 * "did we exercise its full business logic".
 */
import { db, smtpSettingsTable, paymentProvidersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { listPaymentProviderImpls } from "./payments/registry";
import { resolveProviderConfig } from "./payments/resolveProviderConfig";
import { isResearchLabConfigured } from "./researchLab";
import { getTrainerFailureState } from "./qdeTrainer";
import { resolveManagedConfig } from "./secretsVault";
import { logger } from "./logger";

export type ReadinessStatus = "ok" | "degraded" | "unconfigured" | "error";

export interface ReadinessCheck {
  name: string;
  status: ReadinessStatus;
  detail: string;
}

async function checkSmtp(): Promise<ReadinessCheck> {
  try {
    const [settings] = await db.select().from(smtpSettingsTable).where(eq(smtpSettingsTable.isActive, true));
    if (!settings) return { name: "smtp", status: "unconfigured", detail: "No active SMTP configuration." };

    const transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.useTls && settings.port === 465,
      auth: { user: settings.username, pass: settings.password },
    });
    // `verify()` opens a connection and authenticates without sending mail —
    // the correct non-mutating way to validate SMTP credentials.
    await transporter.verify();
    return { name: "smtp", status: "ok", detail: `Connected to ${settings.host}:${settings.port}.` };
  } catch (err) {
    logger.warn(err, "SMTP readiness check failed");
    return { name: "smtp", status: "error", detail: err instanceof Error ? err.message : "Verification failed." };
  }
}

async function checkPaymentProviders(): Promise<ReadinessCheck[]> {
  const rows = await db.select().from(paymentProvidersTable);
  const rowByType = new Map(rows.map((r) => [r.type, r]));
  return Promise.all(listPaymentProviderImpls().map(async (provider) => {
    const config = await resolveProviderConfig(provider.type, rowByType.get(provider.type)?.config);
    const configured = provider.isConfigured(config);
    return {
      name: `payment:${provider.type}`,
      status: configured ? "ok" : "unconfigured",
      detail: configured ? "Configured." : (provider.connectivityNote(config) ?? "Not configured."),
    };
  }));
}

async function checkTrainer(): Promise<ReadinessCheck> {
  const { consecutiveFailures, lastFailureAt } = getTrainerFailureState();
  const trainerUrl = await resolveManagedConfig("trainer.url", "QDE_TRAINER_URL");
  if (!trainerUrl) {
    return { name: "trainer", status: "unconfigured", detail: "No trainer URL set (vault trainer.url / QDE_TRAINER_URL) — running on heuristic fallback only." };
  }
  if (consecutiveFailures >= 3) {
    return { name: "trainer", status: "degraded", detail: `${consecutiveFailures} consecutive failures, last at ${lastFailureAt?.toISOString() ?? "unknown"}.` };
  }
  return { name: "trainer", status: "ok", detail: "Configured, circuit closed." };
}

async function checkResearchLab(): Promise<ReadinessCheck> {
  return (await isResearchLabConfigured())
    ? { name: "research_lab", status: "ok", detail: "Trainer URL configured (vault trainer.url or QDE_RESEARCH_LAB_URL)." }
    : { name: "research_lab", status: "unconfigured", detail: "No trainer URL set (vault trainer.url / QDE_RESEARCH_LAB_URL)." };
}

async function checkDatabase(): Promise<ReadinessCheck> {
  try {
    await db.execute("select 1");
    return { name: "database", status: "ok", detail: "Reachable." };
  } catch (err) {
    return { name: "database", status: "error", detail: err instanceof Error ? err.message : "Unreachable." };
  }
}

// Required for the app to function at all in production; missing any of
// these is a hard misconfiguration, not just a "degraded feature".
const REQUIRED_PRODUCTION_ENV_VARS = [
  "SESSION_SECRET",
];

function checkRequiredEnvVars(): ReadinessCheck {
  const missing = REQUIRED_PRODUCTION_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    return { name: "required_env_vars", status: "error", detail: `Missing: ${missing.join(", ")}` };
  }
  return { name: "required_env_vars", status: "ok", detail: "All required environment variables are set." };
}

export async function runReadinessChecks(): Promise<{ overall: ReadinessStatus; checks: ReadinessCheck[] }> {
  const checks: ReadinessCheck[] = [
    checkRequiredEnvVars(),
    await checkDatabase(),
    await checkSmtp(),
    ...(await checkPaymentProviders()),
    await checkTrainer(),
    await checkResearchLab(),
  ];

  const overall: ReadinessStatus = checks.some((c) => c.status === "error")
    ? "error"
    : checks.some((c) => c.status === "degraded")
      ? "degraded"
      : checks.some((c) => c.status === "unconfigured")
        ? "unconfigured"
        : "ok";

  return { overall, checks };
}

/**
 * Boot-time diagnostic: logs a structured readiness report and, in
 * production, refuses to start if any *required* check is in an error
 * state (currently just required env vars — DB failure already throws
 * naturally on first query, and the rest are optional/degradable features).
 */
export async function runStartupDiagnostics(): Promise<void> {
  const envCheck = checkRequiredEnvVars();
  logger.info({ check: envCheck }, "Startup diagnostic: required environment variables");
  if (envCheck.status === "error" && process.env.NODE_ENV === "production") {
    throw new Error(`Startup diagnostics failed: ${envCheck.detail}`);
  }

  const { overall, checks } = await runReadinessChecks();
  logger.info({ overall, checks }, "Startup diagnostic: dependency readiness report");
}
