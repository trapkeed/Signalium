import { retryWithBackoff } from "./retry";

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
export async function decideAction(telemetry: TelemetrySnapshot): Promise<TrainerDecision> {
  return retryWithBackoff(() => runTrainer(telemetry), {
    retries: 3,
    baseDelayMs: 150,
  });
}

async function runTrainer(t: TelemetrySnapshot): Promise<TrainerDecision> {
  const trainerUrl = process.env["QDE_TRAINER_URL"];
  if (trainerUrl) {
    return callExternalTrainer(trainerUrl, t);
  }
  return simulateTrainerHeuristic(t);
}

async function callExternalTrainer(url: string, telemetry: TelemetrySnapshot): Promise<TrainerDecision> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
