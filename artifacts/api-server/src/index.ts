import app from "./app";
import { logger } from "./lib/logger";
import { seedSymbolRegistry } from "./lib/symbolNormalizer";
import { attachEaGateway } from "./ws/eaGateway";
import { deploymentManager } from "./lib/deploymentManager";

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
});

attachEaGateway(server);

// S21B: Initialize deployment manager from DB, then start background polling
deploymentManager
  .initialize()
  .then(() => {
    deploymentManager.startPolling(5 * 60 * 1_000); // poll every 5 minutes
    // Flush health samples every 5 minutes aligned with the polling interval
    setInterval(() => {
      deploymentManager.flushHealthSample().catch((err) => {
        logger.warn({ err }, "Failed to flush deployment health sample");
      });
    }, 5 * 60 * 1_000);
  })
  .catch((err) => {
    logger.error({ err }, "Failed to initialize deployment manager — inference will run unversioned");
  });
