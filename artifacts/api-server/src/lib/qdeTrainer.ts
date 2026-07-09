import crypto from "crypto";
import { retryWithBackoff } from "./retry";
import { getServiceToken } from "./sso";
import { getCircuitBreaker } from "./circuitBreaker";
import { resolveManagedConfig } from "./secretsVault";

// S26: fail fast + degrade gracefully once the external trainer is clearly
// down, instead of retrying (and timing out) on every single EA tick while
// it's unresponsive. When open, callers fall back to the local heuristic
// decision tree so EAs keep receiving *some* guidance instead of nothing.
const trainerBreaker = getCircuitBreaker("qde-trainer", { failureThreshold: 4, resetTimeoutMs: 60_000, timeoutMs: 8_000 });

export const TRAINER_ACTIONS = [
  "HOLD",
  "ADD",
  "REDUCE",
  "TRAIL",
  "BREAKEVEN",
  "LOCK_PROFIT",
  "CLOSE",
] as const;

export type TrainerActionType = (typeof TRAINER_ACTIONS)[number];

export interface TelemetrySnapshot {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  openPositions: number;
  floatingPnl: number;
  entryPrice?: number | null;
  currentPrice?: number | null;
  spread?: number | null;
  swap?: number | null;
  commission?: number | null;
  drawdown?: number | null;
  tradeAgeSeconds?: number | null;
}

export interface TrainerDecision {
  action: TrainerActionType;
  reasoning: string;
}

// ─── Inference Gateway types ─────────────────────────────────────────────────

/** Typed inference request forwarded from the platform to signalium-trainer. */
export type InferenceRequest =
  | {
      type: "inference";
      symbol: string;
      userId: string;
      telemetry: TelemetrySnapshot | null;
      /** S21B: instruct the trainer to use a specific deployed model version. */
      targetModelVersion?: string | null;
    }
  | {
      type: "review-position";
      symbol: string;
      userId: string;
      positionContext: {
        entryPrice?: number;
        currentPrice?: number;
        profit?: number;
        drawdown?: number;
        duration?: number;
        spread?: number;
        slippage?: number;
        swap?: number;
        commission?: number;
      };
      targetModelVersion?: string | null;
    }
  | {
      type: "manual-analysis";
      symbol: string;
      userId: string;
      timeframe: string;
      notes: string | null;
      telemetry: TelemetrySnapshot | null;
      targetModelVersion?: string | null;
    }
  | {
      type: "portfolio-review";
      userId: string;
      positions: Array<{
        symbol: string;
        balance: number;
        equity: number;
        openPositions: number;
        floatingPnl: number;
        drawdown?: number | null;
        entryPrice?: number | null;
        currentPrice?: number | null;
      }>;
      targetModelVersion?: string | null;
    }
  | {
      type: "reasoning";
      symbol: string;
      userId: string;
      question: string | null;
      opportunityContext: {
        state: string;
        direction?: string;
        confidence?: number;
        reasoning?: string;
      } | null;
      targetModelVersion?: string | null;
    };

/** Structured response the trainer returns for any inference request type. */
export interface InferenceResponse {
  direction?: string;          // "LONG" | "SHORT" | "NEUTRAL"
  confidence?: number;         // 0–1
  risk_signal?: string;        // "LOW" | "MEDIUM" | "HIGH" | "EXTREME"
  size_signal?: string;        // "MINIMAL" | "NORMAL" | "AGGRESSIVE"
  entry_urgency?: string;      // "IMMEDIATE" | "PENDING" | "CONDITIONAL"
  exit_horizon?: string;       // "SCALP" | "INTRADAY" | "SWING" | "HOLD"
  reasoning: string;
  warnings?: string[];
  model_version?: string;
  latency_ms?: number;
  // Portfolio review returns per-position assessments
  positions?: Array<{
    symbol: string;
    action: TrainerActionType;
    reasoning: string;
    confidence?: number;
  }>;
}

/**
 * Forward a typed inference request to signalium-trainer.
 *
 * When QDE_TRAINER_URL is set, the request is proxied verbatim and the trainer
 * response is returned. When the trainer is offline, a heuristic fallback
 * produces a structurally-valid InferenceResponse so the gateway never
 * hard-fails.
 */
export async function callTrainerInference(request: InferenceRequest): Promise<InferenceResponse> {
  return retryWithBackoff(() => runInference(request), { retries: 2, baseDelayMs: 100 });
}

/**
 * Resolves the trainer base URL from the admin-managed vault first (key
 * `trainer.url`, set via Admin → Managed Secrets), falling back to the
 * `QDE_TRAINER_URL` env var. Neither is hardcoded — an unconfigured trainer
 * means the platform runs entirely on local heuristics until an admin sets
 * one of these.
 */
async function resolveTrainerUrl(): Promise<string | null> {
  return resolveManagedConfig("trainer.url", "QDE_TRAINER_URL");
}

/** Whether a trainer URL is currently configured (vault or env). Used by the sync-status dashboard to distinguish "unconfigured" from "configured but unreachable". */
export async function isQdeTrainerConfigured(): Promise<boolean> {
  return !!(await resolveTrainerUrl());
}

/**
 * Lightweight reachability probe for the sync-status dashboard — hits the
 * trainer base URL directly rather than reusing the heavier inference
 * circuit breaker, so a status-page view never trips or resets it.
 */
export async function checkTrainerReachability(): Promise<{ configured: boolean; reachable: boolean; latencyMs: number | null; error: string | null }> {
  const trainerUrl = await resolveTrainerUrl();
  if (!trainerUrl) return { configured: false, reachable: false, latencyMs: null, error: null };
  const started = Date.now();
  try {
    const serviceToken = await getServiceToken();
    const res = await fetch(`${trainerUrl.replace(/\/$/, "")}/health`, {
      headers: { Authorization: `Bearer ${serviceToken}` },
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { configured: true, reachable: false, latencyMs, error: `HTTP ${res.status}` };
    return { configured: true, reachable: true, latencyMs, error: null };
  } catch (err) {
    return { configured: true, reachable: false, latencyMs: Date.now() - started, error: (err as Error).message };
  }
}

/**
 * Builds request-signing metadata headers, additive to the existing signed
 * JWT service token: a per-request nonce + id (replay/dedup hints for the
 * trainer side) and a timestamp, plus the caller's service identity.
 */
function buildSigningHeaders(): Record<string, string> {
  return {
    "X-Signalium-Nonce": crypto.randomBytes(16).toString("hex"),
    "X-Signalium-Request-Id": crypto.randomUUID(),
    "X-Signalium-Service-Id": "signalium-platform",
    "X-Signalium-Timestamp": new Date().toISOString(),
  };
}

async function runInference(request: InferenceRequest): Promise<InferenceResponse> {
  const trainerUrl = await resolveTrainerUrl();
  if (trainerUrl) {
    return callExternalInference(trainerUrl, request);
  }
  return simulateInferenceHeuristic(request);
}

async function callExternalInference(baseUrl: string, request: InferenceRequest): Promise<InferenceResponse> {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/qde/${request.type}`;
  // S24C: attach a signed SSO service token — Trainer verifies it against
  // Signalium's JWKS instead of trusting an unauthenticated caller.
  const serviceToken = await getServiceToken();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceToken}`,
      ...buildSigningHeaders(),
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Trainer responded with ${res.status}`);
  const data = (await res.json()) as Partial<InferenceResponse>;
  if (!data.reasoning) throw new Error("Trainer returned no reasoning");
  return data as InferenceResponse;
}

/**
 * Heuristic fallback when the trainer is not connected.
 * Returns a structurally-valid InferenceResponse based on available telemetry.
 */
function simulateInferenceHeuristic(request: InferenceRequest): InferenceResponse {
  if (request.type === "portfolio-review") {
    return {
      reasoning: "Portfolio review requires the trainer service. Heuristic: monitor positions individually.",
      warnings: ["Trainer offline — portfolio review is unavailable"],
      positions: request.positions.map((p) => ({
        symbol: p.symbol,
        action: "HOLD" as TrainerActionType,
        reasoning: "Trainer offline — defaulting to HOLD",
        confidence: 0.5,
      })),
    };
  }

  if (request.type === "reasoning") {
    return {
      reasoning: "Trainer offline. Reasoning requests require the signalium-trainer service.",
      warnings: ["Trainer offline"],
    };
  }

  // For inference / manual-analysis / review-position — use telemetry if available
  const telemetry =
    request.type === "inference" || request.type === "manual-analysis"
      ? request.telemetry
      : request.type === "review-position"
        ? ({
            balance: 10000,
            equity: 10000,
            margin: 0,
            freeMargin: 10000,
            openPositions: 1,
            floatingPnl: request.positionContext.profit ?? 0,
            drawdown: request.positionContext.drawdown ?? null,
            tradeAgeSeconds: request.positionContext.duration ?? null,
            entryPrice: request.positionContext.entryPrice ?? null,
            currentPrice: request.positionContext.currentPrice ?? null,
            spread: request.positionContext.spread ?? null,
            swap: null,
            commission: null,
          } satisfies TelemetrySnapshot)
        : null;

  if (!telemetry) {
    return {
      direction: "NEUTRAL",
      confidence: 0.5,
      risk_signal: "MEDIUM",
      reasoning: "Trainer offline and no telemetry available — cannot generate inference.",
      warnings: ["Trainer offline", "No telemetry data"],
    };
  }

  const decision = simulateTrainerHeuristic(telemetry);
  const pnlPct = (telemetry.floatingPnl / Math.max(telemetry.equity, 1)) * 100;

  return {
    direction: pnlPct >= 0 ? "LONG" : "SHORT",
    confidence: Math.max(0.3, Math.min(0.9, 0.5 + Math.abs(pnlPct) * 0.05)),
    risk_signal: (telemetry.drawdown ?? 0) >= 10 ? "HIGH" : "MEDIUM",
    size_signal: "NORMAL",
    entry_urgency: decision.action === "ADD" ? "IMMEDIATE" : "CONDITIONAL",
    exit_horizon: "INTRADAY",
    reasoning: `[Heuristic fallback — trainer offline] ${decision.reasoning}`,
    warnings: ["Trainer offline — heuristic decision only"],
  };
}

/**
 * The QDE ("Quantitative Decision Engine" / trainer) reasons about an open
 * position exactly as a professional trader would: cut losers fast, protect
 * winners, and let strong trends run with protection in place.
 *
 * This is an in-process simulation of the trainer's decision logic. If
 * QDE_TRAINER_URL is configured, decisions are instead requested from a real
 * external trainer service over HTTP — the interface (input/output shape) is
 * identical either way, so swapping in a real trainer requires no changes to
 * the platform's forwarding/queueing logic.
 */
// ─── S23b: trainer availability tracking ───────────────────────────────────
// In-memory counters (per process) so the alerting engine can detect a
// trainer that's persistently failing, without adding a DB round-trip to the
// hot telemetry-ingest path. Reset on the next successful decision.
let consecutiveTrainerFailures = 0;
let lastTrainerFailureAt: Date | null = null;

export function getTrainerFailureState(): { consecutiveFailures: number; lastFailureAt: Date | null } {
  return { consecutiveFailures: consecutiveTrainerFailures, lastFailureAt: lastTrainerFailureAt };
}

export async function decideAction(telemetry: TelemetrySnapshot): Promise<TrainerDecision> {
  try {
    const decision = await retryWithBackoff(() => runTrainer(telemetry), {
      retries: 3,
      baseDelayMs: 150,
    });
    consecutiveTrainerFailures = 0;
    return decision;
  } catch (err) {
    consecutiveTrainerFailures += 1;
    lastTrainerFailureAt = new Date();
    throw err;
  }
}

async function runTrainer(t: TelemetrySnapshot): Promise<TrainerDecision> {
  const trainerUrl = await resolveTrainerUrl();
  if (!trainerUrl) {
    return simulateTrainerHeuristic(t);
  }
  // Graceful degradation: if the external trainer's circuit is open, skip
  // straight to the local heuristic instead of throwing — an EA should never
  // be left with "no action" just because the ML service is temporarily down.
  return trainerBreaker.execute(
    () => callExternalTrainer(trainerUrl, t),
    () => simulateTrainerHeuristic(t),
  );
}

async function callExternalTrainer(url: string, telemetry: TelemetrySnapshot): Promise<TrainerDecision> {
  const serviceToken = await getServiceToken();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceToken}`,
      ...buildSigningHeaders(),
    },
    body: JSON.stringify(telemetry),
  });
  if (!res.ok) {
    throw new Error(`Trainer service responded with ${res.status}`);
  }
  const data = (await res.json()) as Partial<TrainerDecision>;
  if (!data.action || !TRAINER_ACTIONS.includes(data.action as TrainerActionType)) {
    throw new Error("Trainer service returned an invalid action");
  }
  return { action: data.action as TrainerActionType, reasoning: data.reasoning ?? "" };
}

/**
 * Heuristic decision tree standing in for the real QDE model. Mirrors the
 * kind of reasoning a discretionary trader applies to an open position:
 * survival first (cut deep drawdowns), then protection of gains, then
 * patience while a position is developing normally.
 */
function simulateTrainerHeuristic(t: TelemetrySnapshot): TrainerDecision {
  const equity = t.equity || 1;
  const pnlPct = (t.floatingPnl / equity) * 100;
  const drawdownPct = t.drawdown ?? Math.max(0, -pnlPct);
  const ageMinutes = (t.tradeAgeSeconds ?? 0) / 60;
  const marginUtilization = t.margin / Math.max(t.balance, 1);

  if (t.openPositions === 0) {
    return { action: "HOLD", reasoning: "No open positions to manage." };
  }

  if (drawdownPct >= 15 || marginUtilization >= 0.8) {
    return {
      action: "CLOSE",
      reasoning: `Drawdown ${drawdownPct.toFixed(1)}% / margin utilization ${(marginUtilization * 100).toFixed(0)}% breach risk limits — closing to preserve capital.`,
    };
  }

  if (drawdownPct >= 8) {
    return {
      action: "REDUCE",
      reasoning: `Drawdown ${drawdownPct.toFixed(1)}% is elevated — reducing exposure while the thesis is reassessed.`,
    };
  }

  if (pnlPct >= 6 && ageMinutes >= 30) {
    return {
      action: "LOCK_PROFIT",
      reasoning: `Position up ${pnlPct.toFixed(1)}% after ${ageMinutes.toFixed(0)}m — locking in gains against a reversal.`,
    };
  }

  if (pnlPct >= 3) {
    return {
      action: "TRAIL",
      reasoning: `Position up ${pnlPct.toFixed(1)}% and still trending favorably — trailing the stop to ride further upside.`,
    };
  }

  if (pnlPct >= 0.5 && ageMinutes >= 45) {
    return {
      action: "BREAKEVEN",
      reasoning: `Modest gain (${pnlPct.toFixed(1)}%) sustained for ${ageMinutes.toFixed(0)}m — moving stop to breakeven removes downside risk.`,
    };
  }

  if (pnlPct >= 1.5 && ageMinutes < 20 && marginUtilization < 0.3) {
    return {
      action: "ADD",
      reasoning: `Fast favorable move (${pnlPct.toFixed(1)}% in ${ageMinutes.toFixed(0)}m) with headroom in margin — adding to the winner.`,
    };
  }

  return {
    action: "HOLD",
    reasoning: `Position within normal range (${pnlPct.toFixed(1)}% P&L, ${drawdownPct.toFixed(1)}% drawdown) — no action needed.`,
  };
}
