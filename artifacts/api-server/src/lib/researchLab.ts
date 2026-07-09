/**
 * S24B — Research Lab Gateway Client
 *
 * Thin HTTP client for the signalium-trainer Research Lab API. Signalium
 * never re-implements trainer business logic (experiment tracking, training
 * loops, validation/certification, shadow testing, deployment candidate
 * scoring, research intelligence, or genealogy computation) — every function
 * here proxies a read or action verbatim to the trainer and returns its
 * response unmodified.
 *
 * Mirrors the fallback pattern established in qdeTrainer.ts / deploymentClient.ts:
 *   - QDE_RESEARCH_LAB_URL unset  -> functions throw ResearchLabUnavailableError
 *   - QDE_RESEARCH_LAB_URL set    -> real HTTP call; a non-2xx or network/timeout
 *     failure is also normalized into ResearchLabUnavailableError
 *
 * There is deliberately NO heuristic/simulated fallback here (unlike
 * qdeTrainer.ts's inference heuristic) — research/training/deployment data
 * is not safe to fabricate. Callers must render an explicit "unavailable"
 * state instead of synthesizing data.
 */
import { logger } from "./logger";
import { getServiceToken } from "./sso";

export class ResearchLabUnavailableError extends Error {
  constructor(detail?: string) {
    super(detail ? `Research Lab unavailable: ${detail}` : "Research Lab unavailable");
    this.name = "ResearchLabUnavailableError";
  }
}

function getBaseUrl(): string | null {
  return process.env["QDE_RESEARCH_LAB_URL"] || null;
}

export function isResearchLabConfigured(): boolean {
  return !!getBaseUrl();
}

async function labFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    throw new ResearchLabUnavailableError("QDE_RESEARCH_LAB_URL is not configured");
  }
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  try {
    // S24C: Signalium is the ecosystem's identity authority — every outbound
    // call to the trainer carries a signed SSO service token so Trainer
    // never has to trust an unauthenticated caller (and never needs its own
    // administrator auth or password store).
    const serviceToken = await getServiceToken();
    const res = await fetch(url, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceToken}`, ...(opts?.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      let bodyText = "";
      try { bodyText = await res.text(); } catch { /* ignore */ }
      logger.warn({ url: path, status: res.status }, "Research Lab request returned non-2xx");
      throw new ResearchLabUnavailableError(`trainer responded with ${res.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ""}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ResearchLabUnavailableError) throw err;
    logger.warn({ err, url: path }, "Research Lab request failed");
    throw new ResearchLabUnavailableError((err as Error).message);
  }
}

// ─── 1. Experiments ───────────────────────────────────────────────────────────

export interface ExperimentSummary {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export function listExperiments(params?: { limit?: number; status?: string }) {
  const q = new URLSearchParams();
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return labFetch<{ experiments: ExperimentSummary[] }>(`/experiments${qs ? `?${qs}` : ""}`);
}

export function getExperiment(id: string) {
  return labFetch<{ experiment: ExperimentSummary & Record<string, unknown> }>(`/experiments/${encodeURIComponent(id)}`);
}

export function getExperimentLineage(id: string) {
  return labFetch<{ lineage: unknown }>(`/experiments/${encodeURIComponent(id)}/lineage`);
}

export function getExperimentHistory(id: string) {
  return labFetch<{ history: unknown[] }>(`/experiments/${encodeURIComponent(id)}/history`);
}

// ─── 2. Training ──────────────────────────────────────────────────────────────

export function listTrainingRuns(params?: { status?: string; limit?: number }) {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return labFetch<{ runs: unknown[] }>(`/training/runs${qs ? `?${qs}` : ""}`);
}

export function getTrainingRun(id: string) {
  return labFetch<{ run: Record<string, unknown> }>(`/training/runs/${encodeURIComponent(id)}`);
}

export function getTrainingResourceUsage() {
  return labFetch<{ usage: Record<string, unknown> }>(`/training/resource-usage`);
}

// ─── 3. Validation ────────────────────────────────────────────────────────────

export function listValidationReports(params?: { limit?: number }) {
  const q = params?.limit ? `?limit=${params.limit}` : "";
  return labFetch<{ reports: unknown[] }>(`/validation/reports${q}`);
}

export function getValidationReport(id: string) {
  return labFetch<{ report: Record<string, unknown> }>(`/validation/reports/${encodeURIComponent(id)}`);
}

export function getDriftMonitoring() {
  return labFetch<{ drift: Record<string, unknown> }>(`/validation/drift`);
}

export function getRobustnessTests(params?: { limit?: number }) {
  const q = params?.limit ? `?limit=${params.limit}` : "";
  return labFetch<{ tests: unknown[] }>(`/validation/robustness${q}`);
}

// ─── 4. Shadow Testing ────────────────────────────────────────────────────────

export function listShadowDeployments(params?: { status?: string }) {
  const q = params?.status ? `?status=${encodeURIComponent(params.status)}` : "";
  return labFetch<{ deployments: unknown[] }>(`/shadow-testing/deployments${q}`);
}

export function getShadowComparison(id: string) {
  return labFetch<{ comparison: Record<string, unknown> }>(`/shadow-testing/deployments/${encodeURIComponent(id)}/comparison`);
}

export function getShadowAgreementAnalysis(id: string) {
  return labFetch<{ agreement: Record<string, unknown> }>(`/shadow-testing/deployments/${encodeURIComponent(id)}/agreement`);
}

export function getShadowRegimeComparison(id: string) {
  return labFetch<{ regimes: unknown[] }>(`/shadow-testing/deployments/${encodeURIComponent(id)}/regimes`);
}

// ─── 5. Deployment (candidates) ───────────────────────────────────────────────

export function listDeploymentCandidates(params?: { status?: string }) {
  const q = params?.status ? `?status=${encodeURIComponent(params.status)}` : "";
  return labFetch<{ candidates: unknown[] }>(`/deployment-candidates${q}`);
}

export function getDeploymentCandidate(id: string) {
  return labFetch<{ candidate: Record<string, unknown> }>(`/deployment-candidates/${encodeURIComponent(id)}`);
}

export function approveDeploymentCandidate(id: string, actorUserId: string) {
  return labFetch<{ ok: boolean; message?: string }>(`/deployment-candidates/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: JSON.stringify({ actorUserId }),
  });
}

export function rollbackDeploymentCandidate(id: string, actorUserId: string, reason?: string) {
  return labFetch<{ ok: boolean; message?: string }>(`/deployment-candidates/${encodeURIComponent(id)}/rollback`, {
    method: "POST",
    body: JSON.stringify({ actorUserId, reason: reason ?? null }),
  });
}

export function getResearchDeploymentHistory(params?: { limit?: number }) {
  const q = params?.limit ? `?limit=${params.limit}` : "";
  return labFetch<{ history: unknown[] }>(`/deployment-candidates/history${q}`);
}

// ─── 6. Research Intelligence ─────────────────────────────────────────────────

export function listDiscoveredFeatures(params?: { limit?: number }) {
  const q = params?.limit ? `?limit=${params.limit}` : "";
  return labFetch<{ features: unknown[] }>(`/research-intelligence/features${q}`);
}

export function listFailureInvestigations(params?: { limit?: number }) {
  const q = params?.limit ? `?limit=${params.limit}` : "";
  return labFetch<{ investigations: unknown[] }>(`/research-intelligence/failure-investigations${q}`);
}

export function listSelfEvaluationFindings(params?: { limit?: number }) {
  const q = params?.limit ? `?limit=${params.limit}` : "";
  return labFetch<{ findings: unknown[] }>(`/research-intelligence/self-evaluations${q}`);
}

export function listRetrainingRecommendations(params?: { limit?: number }) {
  const q = params?.limit ? `?limit=${params.limit}` : "";
  return labFetch<{ recommendations: unknown[] }>(`/research-intelligence/retraining-recommendations${q}`);
}

// ─── 7. QDE Genealogy ──────────────────────────────────────────────────────────

export function getModelGenealogy(modelVersion: string) {
  return labFetch<{ genealogy: Record<string, unknown> }>(`/genealogy/${encodeURIComponent(modelVersion)}`);
}

export function getGenealogyTree(rootModelVersion?: string) {
  const q = rootModelVersion ? `?root=${encodeURIComponent(rootModelVersion)}` : "";
  return labFetch<{ tree: Record<string, unknown> }>(`/genealogy/tree${q}`);
}

export function listArtifactHistory(modelVersion: string) {
  return labFetch<{ artifacts: unknown[] }>(`/genealogy/${encodeURIComponent(modelVersion)}/artifacts`);
}
