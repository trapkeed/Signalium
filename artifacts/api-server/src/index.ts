import app from "./app";
import { logger } from "./lib/logger";
import { seedSymbolRegistry } from "./lib/symbolNormalizer";
import { attachEaGateway } from "./ws/eaGateway";
import { attachAdminOpsGateway } from "./ws/adminOpsGateway";
import { deploymentManager } from "./lib/deploymentManager";
import { startPlatformHealthMonitor, markSchedulerHeartbeat } from "./lib/platformHealth";
import { recordBackendDeploymentIfChanged } from "./lib/serviceVersion";
import { startAlertSweep } from "./lib/alertDetectors";
import { startSecuritySweep } from "./lib/securityDetectors";
import { startJobQueueWorker } from "./lib/jobQueue";
import { startBackupScheduler } from "./lib/backupService";
import { startAuditRetentionSweep } from "./lib/auditRetention";
import { seedSecretRotationTracking } from "./lib/secretRotation";
import { startAccountDeletionSweep } from "./lib/dataGovernance";
import { runStartupDiagnostics } from "./lib/productionReadiness";
import { seedMarketDataProviders } from "./lib/marketData/seed";
import { startMarketDataHealthSweep } from "./lib/marketData/health";
import { startRunpodMonitor } from "./lib/runpod/monitor";
import { startCommandRetrySweep } from "./lib/commandRetry";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  seedSymbolRegistry().catch((seedErr) => {
    logger.error({ err: seedErr }, "Failed to seed symbol registry");
  });

  seedMarketDataProviders()
    .then(() => startMarketDataHealthSweep(5 * 60_000)) // sweep every 5 minutes
    .catch((seedErr) => {
      logger.error({ err: seedErr }, "Failed to seed market data providers");
    });

  startRunpodMonitor(60_000); // poll active RunPod pods every minute

// C8: Automated command retry sweep — re-queues delivered actions that have
// not been acknowledged within the TTL, increments retry_count, and marks
// exhausted commands as failed. Runs every 60 seconds.
startCommandRetrySweep(60_000);

  // S30: post-listen startup diagnostics — logs a dependency readiness
  // report and, in production, exits if a required env var is missing.
  // Runs after listen() so the port is already bound (no delay to first
  // health-check response) but before real traffic is expected.
  runStartupDiagnostics().catch((diagErr) => {
    logger.error({ err: diagErr }, "Startup diagnostics failed");
    if (process.env.NODE_ENV === "production") process.exit(1);
  });
});

attachEaGateway(server);
attachAdminOpsGateway(server);

// S23a: Platform-level system health monitoring (CPU/RAM/event-loop lag/DB
// latency/WS connections), independent of QDE deployment health.
startPlatformHealthMonitor(60 * 1_000); // sample every 60 seconds

// S23b: Alerting engine — periodic detectors for trainer/inference/latency/DB/
// payment/data-provider/market-wide issues, deduped and dispatched to
// configured delivery channels (dashboard + email always; Telegram/Discord
// when credentials are present).
startAlertSweep(2 * 60_000); // sweep every 2 minutes
startSecuritySweep(5 * 60_000); // sweep every 5 minutes

// S26: Scalability/HA/DR background workers — durable job-queue dispatch,
// daily logical DB backups (+ retention prune), and audit-log retention.
startJobQueueWorker(15 * 1_000);
startBackupScheduler(24 * 60 * 60 * 1_000);
startAuditRetentionSweep(24 * 60 * 60 * 1_000);
seedSecretRotationTracking().catch((err) => {
  logger.warn({ err }, "Failed to seed secret rotation tracking");
});

// S28: processes account-deletion requests whose grace period has elapsed
startAccountDeletionSweep(60 * 60 * 1_000);

// S23a: Record the backend's current git commit as a deployment version
// (display-only, for the admin deployment dashboard's rollback reference).
recordBackendDeploymentIfChanged().catch((err) => {
  logger.warn({ err }, "Failed to record backend service deployment version");
});

// S21B: Initialize deployment manager from DB, then start background polling
deploymentManager
  .initialize()
  .then(() => {
    deploymentManager.startPolling(5 * 60 * 1_000); // poll every 5 minutes
    // Flush health samples every 5 minutes aligned with the polling interval
    setInterval(() => {
      markSchedulerHeartbeat();
      deploymentManager.flushHealthSample().catch((err) => {
        logger.warn({ err }, "Failed to flush deployment health sample");
      });
    }, 5 * 60 * 1_000);
  })
  .catch((err) => {
    logger.error({ err }, "Failed to initialize deployment manager — inference will run unversioned");
  });
