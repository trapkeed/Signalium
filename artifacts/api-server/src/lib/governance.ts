/**
 * S27 — Deployment Governance Visibility.
 *
 * Read-only, institutional-facing summary of QDE deployment governance,
 * aggregated from data we already own (qde_deployments / health / events —
 * S21B) and a strict, allowlisted subset of signalium-trainer's Research
 * Lab data (S24B) — certification status, validation score, and shadow
 * testing status ONLY. This module never surfaces experiments, datasets,
 * feature engineering, training runs, deployment approvals, or research
 * findings — those stay behind the existing research-lab.ts gateway, which
 * has its own stricter, research-role-gated access.
 *
 * Two visibility tiers (enforced by the caller — routes/governance.ts):
 *   - "full": SuperAdmin/Admin. Complete history, raw scores, event detail.
 *   - "strategic": Founder. High-level status + bucketed scores + a short
 *     history window — enough to answer "is the model healthy and
 *     certified", not enough to reconstruct operational/engineering detail.
 */
import { db, qdeDeploymentsTable, qdeDeploymentEventsTable, qdeDeploymentHealthTable } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { deploymentManager } from "./deploymentManager";
import * as researchLab from "./researchLab";
import { ResearchLabUnavailableError } from "./researchLab";
import { logger } from "./logger";

export type GovernanceTier = "full" | "strategic";

export interface GovernanceSummary {
  activeVersion: string | null;
  deploymentStatus: string | null;
  certificationStatus: string | null;
  healthScore: number | string | null;
  validationScore: number | string | null;
  shadowTestingStatus: string | null;
  researchLabConfigured: boolean;
  deploymentHistory: Array<Record<string, unknown>>;
  rollbackHistory: Array<Record<string, unknown>>;
}

// ─── Internal (Signalium-owned) deployment data ───────────────────────────

async function getActiveDeploymentRow() {
  const [active] = await db
    .select()
    .from(qdeDeploymentsTable)
    .where(eq(qdeDeploymentsTable.status, "active"))
    .orderBy(desc(qdeDeploymentsTable.activatedAt))
    .limit(1);
  return active ?? null;
}

/** Health score 0-100 derived from the active deployment's most recent recorded window (lower error rate = higher score). Null if no samples yet. */
async function getHealthScore(deploymentDbId: number | null): Promise<number | null> {
  if (!deploymentDbId) return null;
  const [latest] = await db
    .select()
    .from(qdeDeploymentHealthTable)
    .where(eq(qdeDeploymentHealthTable.deploymentId, deploymentDbId))
    .orderBy(desc(qdeDeploymentHealthTable.recordedAt))
    .limit(1);
  if (!latest || latest.errorRate === null) return null;
  return Math.round(Math.max(0, 1 - latest.errorRate) * 100);
}

function bucketScore(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 90) return "healthy";
  if (score >= 70) return "degraded";
  return "critical";
}

// Strict allowlist: deployment/event rows carry operational-engineering
// fields (featureVersion, failureReason, freeform event messages, hashes,
// cache paths, metadata) that are out of scope for governance visibility —
// only the fields a governance summary is defined to show are selected
// here, for BOTH tiers. Do not widen this select without updating the
// module-level doc comment's scope statement.
async function getDeploymentHistory(limit: number) {
  const rows = await db
    .select({
      version: qdeDeploymentsTable.version,
      status: qdeDeploymentsTable.status,
      activatedAt: qdeDeploymentsTable.activatedAt,
      retiredAt: qdeDeploymentsTable.retiredAt,
      createdAt: qdeDeploymentsTable.createdAt,
    })
    .from(qdeDeploymentsTable)
    .orderBy(desc(qdeDeploymentsTable.createdAt))
    .limit(limit);
  return rows;
}

async function getRollbackHistory(limit: number) {
  const rows = await db
    .select({
      eventType: qdeDeploymentEventsTable.eventType,
      occurredAt: qdeDeploymentEventsTable.occurredAt,
      version: qdeDeploymentsTable.version,
    })
    .from(qdeDeploymentEventsTable)
    .leftJoin(qdeDeploymentsTable, eq(qdeDeploymentEventsTable.deploymentId, qdeDeploymentsTable.id))
    .where(inArray(qdeDeploymentEventsTable.eventType, ["rollback_triggered", "rolled_back"]))
    .orderBy(desc(qdeDeploymentEventsTable.occurredAt))
    .limit(limit);
  return rows;
}

// ─── External (Research Lab) governance signals — allowlisted fields only ─

/**
 * Best-effort extraction of a small allowlist of governance fields from an
 * otherwise-opaque trainer record. Trainer response shapes are not owned by
 * Signalium (see researchLab.ts) — we defensively probe a few likely key
 * names and fall back to null rather than guessing at structure.
 */
function pickField(record: Record<string, unknown> | undefined, keys: string[]): unknown {
  if (!record) return null;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return null;
}

interface ExternalGovernanceSignals {
  certificationStatus: string | null;
  validationScore: number | string | null;
  shadowTestingStatus: string | null;
  configured: boolean;
}

async function getExternalGovernanceSignals(activeVersion: string | null): Promise<ExternalGovernanceSignals> {
  if (!researchLab.isResearchLabConfigured()) {
    return { certificationStatus: null, validationScore: null, shadowTestingStatus: null, configured: false };
  }

  let certificationStatus: string | null = null;
  let validationScore: number | string | null = null;
  let shadowTestingStatus: string | null = null;

  try {
    const { reports } = await researchLab.listValidationReports({ limit: 20 });
    const match = (reports as Record<string, unknown>[]).find(
      (r) => !activeVersion || pickField(r, ["modelVersion", "version", "deploymentVersion"]) === activeVersion,
    ) ?? (reports as Record<string, unknown>[])[0];
    certificationStatus = (pickField(match, ["certificationStatus", "certification_status", "certification"]) as string) ?? null;
    validationScore = (pickField(match, ["validationScore", "validation_score", "score"]) as number | string) ?? null;
  } catch (err) {
    if (!(err instanceof ResearchLabUnavailableError)) {
      logger.warn({ err }, "governance: failed to read validation reports");
    }
  }

  try {
    const { deployments } = await researchLab.listShadowDeployments();
    const match = (deployments as Record<string, unknown>[]).find(
      (d) => !activeVersion || pickField(d, ["candidateVersion", "modelVersion", "version"]) === activeVersion,
    );
    shadowTestingStatus = (pickField(match, ["status", "shadowStatus"]) as string) ?? null;
  } catch (err) {
    if (!(err instanceof ResearchLabUnavailableError)) {
      logger.warn({ err }, "governance: failed to read shadow deployments");
    }
  }

  return { certificationStatus, validationScore, shadowTestingStatus, configured: true };
}

// ─── Public entry point ────────────────────────────────────────────────────

export async function buildGovernanceSummary(tier: GovernanceTier): Promise<GovernanceSummary> {
  const [activeRow, historyLimitRows, rollbackRows] = await Promise.all([
    getActiveDeploymentRow(),
    getDeploymentHistory(tier === "full" ? 25 : 5),
    getRollbackHistory(tier === "full" ? 25 : 5),
  ]);

  const activeMeta = deploymentManager.getActiveMeta();
  const activeVersion = activeRow?.version ?? activeMeta?.version ?? null;
  const rawHealthScore = await getHealthScore(activeRow?.id ?? activeMeta?.dbId ?? null);
  const external = await getExternalGovernanceSignals(activeVersion);

  if (tier === "full") {
    return {
      activeVersion,
      deploymentStatus: activeRow?.status ?? null,
      certificationStatus: external.certificationStatus,
      healthScore: rawHealthScore,
      validationScore: external.validationScore,
      shadowTestingStatus: external.shadowTestingStatus,
      researchLabConfigured: external.configured,
      deploymentHistory: historyLimitRows,
      rollbackHistory: rollbackRows,
    };
  }

  // "strategic" (Founder): bucketed scores, no failure reasons/messages, no
  // feature-version/hash-adjacent detail, short history window.
  return {
    activeVersion,
    deploymentStatus: activeRow?.status ?? null,
    certificationStatus: external.certificationStatus,
    healthScore: bucketScore(rawHealthScore),
    validationScore: typeof external.validationScore === "number" ? bucketScore(external.validationScore) : external.validationScore,
    shadowTestingStatus: external.shadowTestingStatus,
    researchLabConfigured: external.configured,
    deploymentHistory: historyLimitRows.map((r) => ({ version: r.version, status: r.status, activatedAt: r.activatedAt })),
    rollbackHistory: rollbackRows.map((r) => ({ version: r.version, occurredAt: r.occurredAt })),
  };
}
