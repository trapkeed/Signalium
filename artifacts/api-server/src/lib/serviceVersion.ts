/**
 * S23a — Backend service version tracking.
 *
 * Records the running git commit hash into `service_deployments` (service =
 * "backend") on startup so the admin deployment dashboard can show the
 * current backend version alongside its deployment history. Display-only —
 * does not perform any rollback action.
 */

import { execSync } from "child_process";
import { db, serviceDeploymentsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";

function getGitCommitHash(): string | null {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8", timeout: 5_000 }).trim() || null;
  } catch (err) {
    logger.warn({ err }, "ServiceVersion: unable to resolve git commit hash");
    return null;
  }
}

export async function recordBackendDeploymentIfChanged(): Promise<void> {
  const gitCommitHash = getGitCommitHash();
  if (!gitCommitHash) return;

  const [latest] = await db
    .select()
    .from(serviceDeploymentsTable)
    .where(eq(serviceDeploymentsTable.service, "backend"))
    .orderBy(desc(serviceDeploymentsTable.deployedAt))
    .limit(1);

  if (latest?.gitCommitHash === gitCommitHash) return; // no change since last recorded boot

  await db.insert(serviceDeploymentsTable).values({
    service: "backend",
    version: gitCommitHash.slice(0, 7),
    gitCommitHash,
    notes: "Auto-recorded on server startup",
  });
  logger.info({ gitCommitHash }, "ServiceVersion: recorded new backend deployment");
}
