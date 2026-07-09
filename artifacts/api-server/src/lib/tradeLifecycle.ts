/**
 * Trade Lifecycle Finalisation (S19)
 *
 * Triggered when an opportunity reaches the EXITED state. Builds the complete
 * trade record: timeline, reasoning validation, failure investigation,
 * counterfactual analysis, and learning candidate classification.
 *
 * All logic here is pure computation on already-persisted data — no inference
 * calls are made. Signalium stores; signalium-trainer learns.
 */

import { db } from "@workspace/db";
import {
  opportunitiesTable,
  qdeDecisionsTable,
  decisionReasoningTable,
  decisionContextTable,
  positionSnapshotsTable,
  positionMetricsTable,
  tradeEventsTable,
  tradeTimelineTable,
  reasoningValidationTable,
  tradeFailuresTable,
  failurePatternsTable,
  counterfactualResultsTable,
  learningCandidatesTable,
} from "@workspace/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { logger } from "./logger";

// ─── helpers ─────────────────────────────────────────────────────────────────

function detectSession(date: Date): string {
  const hour = date.getUTCHours();
  if (hour >= 22 || hour < 8) return "ASIAN";
  if (hour >= 8 && hour < 12) return "LONDON";
  if (hour >= 12 && hour < 16) return "LONDON_NEW_YORK_OVERLAP";
  if (hour >= 16 && hour < 21) return "NEW_YORK";
  return "OFF_SESSION";
}

/**
 * Compute the true R-multiple from price data.
 * R = (exit − entry) / riskDistance for LONG
 * R = (entry − exit) / riskDistance for SHORT
 * Returns null if any required input is missing.
 */
function computeRMultiple(
  direction: string | null,
  entryPrice: number | null,
  exitPrice: number | null,
  stopLoss: number | null,
): number | null {
  if (!direction || entryPrice == null || exitPrice == null || stopLoss == null) return null;
  const riskDistance = Math.abs(entryPrice - stopLoss);
  if (riskDistance === 0) return null;
  if (direction === "LONG") return (exitPrice - entryPrice) / riskDistance;
  if (direction === "SHORT") return (entryPrice - exitPrice) / riskDistance;
  return null;
}

function classifyRMultiple(rMultiple: number | null): "large_win" | "large_loss" | "normal" {
  if (rMultiple === null) return "normal";
  if (rMultiple >= 2) return "large_win";
  if (rMultiple <= -1.5) return "large_loss";
  return "normal";
}

function computeConfidenceStats(series: number[]): {
  volatility: number;
  slope: number;
} {
  if (series.length < 2) return { volatility: 0, slope: 0 };
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length;
  const volatility = Math.sqrt(variance);
  // Simple linear regression slope
  const n = series.length;
  const xMean = (n - 1) / 2;
  const num = series.reduce((s, v, i) => s + (i - xMean) * (v - mean), 0);
  const den = series.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
  const slope = den === 0 ? 0 : num / den;
  return { volatility, slope };
}

// ─── Main finalisation entrypoint ────────────────────────────────────────────

/**
 * Finalise an exited trade — step-level idempotent, throws on failure.
 *
 * Each stage is independently idempotent (onConflictDoNothing / per-row existence
 * check), so retries after partial failure pick up from wherever they left off.
 * Do NOT gate on "timeline already exists" — that coarse guard would permanently
 * skip downstream stages (counterfactuals, failure record, learning candidates)
 * if the first run created the timeline but crashed before completing them.
 *
 * Call finaliseExitedTradeSafe() from fire-and-forget paths.
 */
export async function finaliseExitedTrade(opportunityId: number): Promise<void> {
  const [opp] = await db.select().from(opportunitiesTable).where(eq(opportunitiesTable.id, opportunityId));
  if (!opp) return;
  if (opp.state !== "EXITED") return;

  // Stage 1 — always attempt; each is individually idempotent
  await Promise.all([
    buildTradeTimeline(opp),       // onConflictDoNothing on unique(opportunityId)
    buildReasoningValidation(opp), // existence-check guard inside
  ]);

  // Stage 2 — requires the timeline row (created above or in a prior partial run)
  const [timeline] = await db.select().from(tradeTimelineTable)
    .where(eq(tradeTimelineTable.opportunityId, opportunityId));
  if (!timeline) return; // should not happen; timeline insert failed — caller will throw

  // Always attempt each downstream stage; each is individually idempotent
  await Promise.all([
    buildCounterfactuals(opp, timeline),    // onConflictDoNothing on unique(opportunityId, scenarioType)
    buildFailureRecord(opp, timeline),      // existence-check guard inside
    classifyLearningCandidate(opp, timeline), // onConflictDoNothing on unique(opportunityId, candidateType)
  ]);

  logger.info({ opportunityId }, "Trade lifecycle finalised");
}

/**
 * Fire-and-forget wrapper: logs but does not propagate errors.
 * Use for non-critical paths (e.g., inline after state transition).
 */
export async function finaliseExitedTradeSafe(opportunityId: number): Promise<void> {
  try {
    await finaliseExitedTrade(opportunityId);
  } catch (err) {
    logger.error({ err, opportunityId }, "Failed to finalise trade lifecycle");
  }
}

// ─── Step 1: Trade Timeline ───────────────────────────────────────────────────

async function buildTradeTimeline(opp: typeof opportunitiesTable.$inferSelect) {
  // Count events for this opportunity
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(tradeEventsTable)
    .where(eq(tradeEventsTable.opportunityId, opp.id));

  // Get entry decision's pattern for setupType
  const [entryDecision] = await db.select({
    primaryPattern: decisionReasoningTable.primaryPattern,
    modelVersion: qdeDecisionsTable.modelVersion,
  })
    .from(qdeDecisionsTable)
    .leftJoin(decisionReasoningTable, eq(decisionReasoningTable.decisionId, qdeDecisionsTable.id))
    .where(and(eq(qdeDecisionsTable.opportunityId, opp.id), eq(qdeDecisionsTable.inferenceType, "inference")))
    .limit(1);

  // Get position metrics (for MFE/MAE reference in counterfactuals)
  const [metrics] = await db.select().from(positionMetricsTable).where(eq(positionMetricsTable.opportunityId, opp.id));

  const finalPnl = opp.metadata && typeof opp.metadata === "object" && "final_pnl" in opp.metadata
    ? Number((opp.metadata as Record<string, unknown>).final_pnl)
    : null;

  // Compute R-multiple from actual price data (direction, entry, exit, stop)
  const rMultiple = computeRMultiple(
    opp.direction ?? null,
    opp.entryPrice ?? null,
    opp.currentPrice ?? null,  // currentPrice holds exit price after EXITED
    opp.stopLoss ?? null,
  );

  let outcome: "win" | "loss" | "breakeven" = "breakeven";
  if (finalPnl !== null) {
    if (finalPnl > 0) outcome = "win";
    else if (finalPnl < 0) outcome = "loss";
  } else if (rMultiple !== null) {
    if (rMultiple > 0.1) outcome = "win";
    else if (rMultiple < -0.1) outcome = "loss";
  }

  const durationSeconds =
    opp.enteredAt && opp.exitedAt
      ? Math.floor((opp.exitedAt.getTime() - opp.enteredAt.getTime()) / 1000)
      : null;

  const session = opp.enteredAt ? detectSession(opp.enteredAt) : null;

  await db.insert(tradeTimelineTable).values({
    userId: opp.userId,
    symbol: opp.symbol,
    opportunityId: opp.id,
    entryAt: opp.enteredAt ?? null,
    exitAt: opp.exitedAt ?? null,
    entryPrice: opp.entryPrice ?? null,
    exitPrice: opp.currentPrice ?? null,
    stopLoss: opp.stopLoss ?? null,
    takeProfit: opp.takeProfit ?? null,
    direction: opp.direction ?? null,
    finalPnl,
    rMultiple,
    outcome,
    setupType: entryDecision?.primaryPattern ?? null,
    session,
    modelVersion: entryDecision?.modelVersion ?? null,
    totalEvents: count,
    durationSeconds,
  }).onConflictDoNothing();
}

// ─── Step 2: Reasoning Validation ────────────────────────────────────────────

async function buildReasoningValidation(opp: typeof opportunitiesTable.$inferSelect) {
  const [existing] = await db.select({ id: reasoningValidationTable.id })
    .from(reasoningValidationTable)
    .where(eq(reasoningValidationTable.opportunityId, opp.id));
  if (existing) return;

  // Get the first inference decision for this opportunity
  const [decision] = await db.select({
    id: qdeDecisionsTable.id,
    reasoning: decisionReasoningTable.reasoning,
    primaryPattern: decisionReasoningTable.primaryPattern,
  })
    .from(qdeDecisionsTable)
    .leftJoin(decisionReasoningTable, eq(decisionReasoningTable.decisionId, qdeDecisionsTable.id))
    .where(and(eq(qdeDecisionsTable.opportunityId, opp.id), eq(qdeDecisionsTable.inferenceType, "inference")))
    .orderBy(asc(qdeDecisionsTable.createdAt))
    .limit(1);

  if (!decision) return;

  await db.insert(reasoningValidationTable).values({
    userId: opp.userId,
    symbol: opp.symbol,
    opportunityId: opp.id,
    decisionId: decision.id ?? null,
    initialReasoning: decision.reasoning ?? opp.reasoning,
    initialPattern: decision.primaryPattern ?? null,
    // wasCorrect is null until an admin or the trainer validates it
    wasCorrect: null,
    validatedAt: null,
  }).onConflictDoNothing();
}

// ─── Step 3: Counterfactual Results ──────────────────────────────────────────

async function buildCounterfactuals(
  opp: typeof opportunitiesTable.$inferSelect,
  timeline: typeof tradeTimelineTable.$inferSelect,
) {
  const baseline = timeline.finalPnl ?? 0;
  const stopDistance = opp.stopLoss && opp.entryPrice
    ? Math.abs(opp.entryPrice - opp.stopLoss)
    : null;

  const [metrics] = await db.select().from(positionMetricsTable).where(eq(positionMetricsTable.opportunityId, opp.id));

  const scenarios: Array<typeof counterfactualResultsTable.$inferInsert> = [
    {
      opportunityId: opp.id,
      userId: opp.userId,
      symbol: opp.symbol,
      scenarioType: "wider_stop",
      parameterDescription: "Stop loss 50% wider",
      baselinePnl: baseline,
      counterfactualPnl: stopDistance ? baseline * 1.15 : null,
      improvement: stopDistance ? baseline * 0.15 : null,
      improvementPct: 15,
      analysis:
        "A wider stop would have allowed the position more room to breathe before hitting its target. " +
        "However, it increases risk per trade — only beneficial if the initial stop was placed too tight.",
    },
    {
      opportunityId: opp.id,
      userId: opp.userId,
      symbol: opp.symbol,
      scenarioType: "smaller_size",
      parameterDescription: "Position size 50% of actual",
      baselinePnl: baseline,
      counterfactualPnl: baseline * 0.5,
      improvement: baseline * 0.5 - baseline,
      improvementPct: baseline < 0 ? 50 : -50,
      analysis:
        "Halving position size would have halved both the gain and the loss. " +
        "Beneficial on losing trades; reduces upside on winners. Key question: was full size justified by the setup quality?",
    },
    {
      opportunityId: opp.id,
      userId: opp.userId,
      symbol: opp.symbol,
      scenarioType: "earlier_exit",
      parameterDescription: "Exit at 50% of trade duration",
      baselinePnl: baseline,
      counterfactualPnl: metrics?.mfe != null ? metrics.mfe * 0.5 : null,
      improvement: metrics?.mfe != null ? metrics.mfe * 0.5 - baseline : null,
      improvementPct:
        metrics?.mfe != null && baseline !== 0
          ? ((metrics.mfe * 0.5 - baseline) / Math.abs(baseline)) * 100
          : null,
      analysis:
        "Exiting at the midpoint would have captured a different P/L. " +
        "MFE indicates the best the trade looked — an earlier exit locks in gains before the reversal.",
    },
    {
      opportunityId: opp.id,
      userId: opp.userId,
      symbol: opp.symbol,
      scenarioType: "no_scale_in",
      parameterDescription: "No scale-in; original position size only",
      baselinePnl: baseline,
      counterfactualPnl: metrics?.scaleInCount && metrics.scaleInCount > 0 ? baseline * 0.7 : baseline,
      improvement:
        metrics?.scaleInCount && metrics.scaleInCount > 0 ? baseline * 0.7 - baseline : 0,
      improvementPct: metrics?.scaleInCount && metrics.scaleInCount > 0 ? -30 : 0,
      analysis:
        metrics?.scaleInCount && metrics.scaleInCount > 0
          ? `${metrics.scaleInCount} scale-in(s) executed. Removing them reduces exposure but also reduces profit potential.`
          : "No scale-ins were executed — counterfactual equals baseline.",
    },
  ];

  // onConflictDoNothing ensures idempotency: unique on (opportunityId, scenarioType)
  for (const s of scenarios) {
    await db.insert(counterfactualResultsTable).values(s).onConflictDoNothing();
  }
}

// ─── Step 4: Failure Record ───────────────────────────────────────────────────

async function buildFailureRecord(
  opp: typeof opportunitiesTable.$inferSelect,
  timeline: typeof tradeTimelineTable.$inferSelect,
) {
  // Only for losses beyond 1R (or > 0 absolute loss if R is unknown)
  const isSignificantLoss =
    (timeline.rMultiple !== null && timeline.rMultiple <= -1) ||
    (timeline.rMultiple === null && (timeline.finalPnl ?? 0) < 0);

  if (!isSignificantLoss) return;

  const [existing] = await db.select({ id: tradeFailuresTable.id })
    .from(tradeFailuresTable)
    .where(eq(tradeFailuresTable.opportunityId, opp.id));
  if (existing) return;

  const [metrics] = await db.select().from(positionMetricsTable).where(eq(positionMetricsTable.opportunityId, opp.id));

  // Detect warning signs from metrics
  const warningSigns: string[] = [];
  if (metrics?.confidenceSlope && metrics.confidenceSlope < -0.05) {
    warningSigns.push("Sustained confidence decay before exit");
  }
  if (metrics?.mae && metrics.mfe && metrics.mae > metrics.mfe * 2) {
    warningSigns.push("MAE significantly exceeded MFE — position was adversely positioned");
  }
  if (metrics?.scaleInCount && metrics.scaleInCount > 0) {
    warningSigns.push(`${metrics.scaleInCount} scale-in(s) added to a losing trade`);
  }
  if (opp.warnings && opp.warnings.length > 0) {
    warningSigns.push(...opp.warnings.map((w) => `Model warning: ${w}`));
  }

  const lateExitIndicators: string[] = [];
  if (metrics?.exitEfficiency != null && metrics.exitEfficiency < 0.5) {
    lateExitIndicators.push("Low exit efficiency — position held well past optimal exit");
  }
  if (metrics?.confidenceSlope != null && metrics.confidenceSlope < -0.1) {
    lateExitIndicators.push("Rapid confidence decay indicates delayed exit recognition");
  }

  // Determine root cause heuristically
  let rootCause = "Unknown — requires admin review";
  if (timeline.rMultiple !== null && timeline.rMultiple <= -2) {
    rootCause = "Catastrophic loss — stop loss likely breached or not honored";
  } else if (warningSigns.some((w) => w.includes("scale-in"))) {
    rootCause = "Averaging into a losing position amplified the loss";
  } else if (lateExitIndicators.length > 0) {
    rootCause = "Exit was delayed despite clear deterioration signals";
  } else if (opp.warnings && opp.warnings.length > 2) {
    rootCause = "Multiple model warnings were present but position was entered/held";
  }

  await db.insert(tradeFailuresTable).values({
    userId: opp.userId,
    symbol: opp.symbol,
    opportunityId: opp.id,
    rootCause,
    warningSigns,
    confidenceDecayNotes: metrics?.confidenceSlope != null
      ? `Confidence slope: ${metrics.confidenceSlope.toFixed(4)} (negative = decay). Series had ${metrics.confidenceSeries?.length ?? 0} readings.`
      : null,
    lateExitIndicators,
    positionManagementIssues: [],
    finalLoss: Math.abs(timeline.finalPnl ?? 0),
    maxAdverseExcursion: metrics?.mae ?? null,
  }).onConflictDoNothing();

  // Upsert failure pattern aggregates
  const patternType = rootCause.includes("averaging") ? "scale_in_on_loss"
    : rootCause.includes("delayed") ? "late_exit"
    : rootCause.includes("warnings") ? "overconfidence"
    : "unknown_loss";

  const session = timeline.session ?? "*";

  await db.insert(failurePatternsTable).values({
    patternType,
    symbol: opp.symbol,
    session,
    occurrences: 1,
    avgLoss: Math.abs(timeline.finalPnl ?? 0),
    description: `Auto-generated from trade failure on ${opp.symbol}`,
  }).onConflictDoUpdate({
    target: [failurePatternsTable.patternType, failurePatternsTable.symbol, failurePatternsTable.session],
    set: {
      occurrences: sql`${failurePatternsTable.occurrences} + 1`,
      avgLoss: sql`(${failurePatternsTable.avgLoss} * (${failurePatternsTable.occurrences}) + ${Math.abs(timeline.finalPnl ?? 0)}) / (${failurePatternsTable.occurrences} + 1)`,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

// ─── Step 5: Learning Candidate ───────────────────────────────────────────────

async function classifyLearningCandidate(
  opp: typeof opportunitiesTable.$inferSelect,
  timeline: typeof tradeTimelineTable.$inferSelect,
) {
  const rMultiple = timeline.rMultiple;
  const finalPnl = timeline.finalPnl ?? 0;

  let candidateType: string | null = null;
  let priority = 0;
  let notes = "";

  // Classification rules (most specific first)
  if (rMultiple !== null && rMultiple <= -2) {
    candidateType = "large_loss";
    priority = 100;
    notes = `Catastrophic loss of ${rMultiple.toFixed(2)}R. High priority for trainer to learn what went wrong.`;
  } else if (rMultiple !== null && rMultiple >= 3) {
    candidateType = "large_win";
    priority = 90;
    notes = `Exceptional win of ${rMultiple.toFixed(2)}R. Trainer should learn the entry/management that produced this outcome.`;
  } else if (opp.confidence !== null && opp.confidence >= 0.85 && finalPnl < 0) {
    candidateType = "high_confidence_failure";
    priority = 95;
    notes = `High confidence (${(opp.confidence * 100).toFixed(0)}%) resulted in a loss. Critical lesson for calibration.`;
  } else if (rMultiple !== null && rMultiple <= -1) {
    candidateType = "large_loss";
    priority = 75;
    notes = `Significant loss of ${rMultiple.toFixed(2)}R.`;
  } else if (rMultiple !== null && rMultiple >= 2) {
    candidateType = "large_win";
    priority = 70;
    notes = `Good win of ${rMultiple.toFixed(2)}R.`;
  }

  if (!candidateType) return; // Not a notable enough trade to queue

  // onConflictDoNothing: unique on (opportunityId, candidateType) — safe to retry
  await db.insert(learningCandidatesTable).values({
    opportunityId: opp.id,
    userId: opp.userId,
    symbol: opp.symbol,
    candidateType,
    priority,
    pnl: finalPnl,
    rMultiple,
    notes,
  }).onConflictDoNothing();
}

// ─── Helpers for eaGateway.ts: snapshot + metrics upsert ─────────────────────

export async function ingestPositionSnapshot(params: {
  userId: string;
  symbol: string;
  opportunityId?: number | null;
  telemetryId: number;
  profit: number;
  drawdown?: number | null;
  swap?: number | null;
  commission?: number | null;
  equity: number;
  balance: number;
  margin: number;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  currentPrice?: number | null;
  tradeAgeSeconds?: number | null;
  confidence?: number | null;
}) {
  const equityImpact = params.equity > 0 ? (params.profit / params.equity) * 100 : null;
  const marginUsage = params.balance > 0 ? (params.margin / params.balance) * 100 : null;

  const distanceToStop =
    params.currentPrice && params.stopLoss
      ? Math.abs(params.currentPrice - params.stopLoss)
      : null;
  const distanceToTarget =
    params.currentPrice && params.takeProfit
      ? Math.abs(params.currentPrice - params.takeProfit)
      : null;

  const [snap] = await db.insert(positionSnapshotsTable).values({
    userId: params.userId,
    symbol: params.symbol,
    opportunityId: params.opportunityId ?? null,
    telemetryId: params.telemetryId,
    profit: params.profit,
    drawdown: params.drawdown ?? null,
    swap: params.swap ?? null,
    commission: params.commission ?? null,
    equityImpact,
    distanceToStop,
    distanceToTarget,
    marginUsage,
    positionAgeSeconds: params.tradeAgeSeconds ?? null,
    confidence: params.confidence ?? null,
  }).returning();

  // Upsert position_metrics
  if (params.opportunityId) {
    await upsertPositionMetrics(params.opportunityId, params.userId, params.symbol, params.profit, params.confidence ?? null, params.drawdown);
  }

  return snap;
}

async function upsertPositionMetrics(
  opportunityId: number,
  userId: string,
  symbol: string,
  currentProfit: number,
  confidence: number | null,
  drawdown: number | null | undefined,
) {
  const [existing] = await db.select().from(positionMetricsTable).where(eq(positionMetricsTable.opportunityId, opportunityId));

  if (!existing) {
    const series = confidence !== null ? [confidence] : [];
    await db.insert(positionMetricsTable).values({
      userId,
      symbol,
      opportunityId,
      mfe: Math.max(currentProfit, 0),
      mae: Math.max(-currentProfit, 0),
      peakProfit: currentProfit,
      maxDrawdown: drawdown ?? 0,
      entryConfidence: confidence,
      peakConfidence: confidence,
      minConfidence: confidence,
      confidenceVolatility: 0,
      confidenceSlope: 0,
      confidenceSeries: series,
      snapshotCount: 1,
    });
    return;
  }

  const newSeries = confidence !== null
    ? [...(existing.confidenceSeries ?? []), confidence]
    : (existing.confidenceSeries ?? []);
  const { volatility, slope } = computeConfidenceStats(newSeries);

  await db.update(positionMetricsTable).set({
    mfe: Math.max(existing.mfe ?? 0, currentProfit),
    mae: Math.max(existing.mae ?? 0, -currentProfit),
    peakProfit: Math.max(existing.peakProfit ?? currentProfit, currentProfit),
    maxDrawdown: Math.max(existing.maxDrawdown ?? 0, drawdown ?? 0),
    peakConfidence: confidence !== null ? Math.max(existing.peakConfidence ?? 0, confidence) : existing.peakConfidence,
    minConfidence: confidence !== null ? Math.min(existing.minConfidence ?? 1, confidence) : existing.minConfidence,
    confidenceVolatility: volatility,
    confidenceSlope: slope,
    confidenceSeries: newSeries,
    snapshotCount: (existing.snapshotCount ?? 0) + 1,
    updatedAt: new Date(),
  }).where(eq(positionMetricsTable.opportunityId, opportunityId));
}

// ─── Emit a trade event ───────────────────────────────────────────────────────

export async function emitTradeEvent(params: {
  userId: string;
  symbol: string;
  opportunityId: number;
  eventType: string;
  confidence?: number | null;
  price?: number | null;
  note?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}) {
  await db.insert(tradeEventsTable).values({
    userId: params.userId,
    symbol: params.symbol,
    opportunityId: params.opportunityId,
    eventType: params.eventType,
    confidence: params.confidence ?? null,
    price: params.price ?? null,
    note: params.note ?? null,
    metadata: params.metadata ?? null,
    occurredAt: params.occurredAt ?? new Date(),
  });
}

// ─── Capture a QDE decision ───────────────────────────────────────────────────

export async function captureQdeDecision(params: {
  symbol: string;
  userId: string;
  opportunityId?: number | null;
  telemetryId?: number | null;
  inferenceType: string;
  request: Record<string, unknown>;
  response: {
    direction?: string;
    confidence?: number;
    risk_signal?: string;
    size_signal?: string;
    entry_urgency?: string;
    exit_horizon?: string;
    reasoning: string;
    warnings?: string[];
    model_version?: string;
  };
  trainerOnline: boolean;
  /** S21B — deployment traceability fields from the active deployment at call time. */
  artifactHash?: string | null;
  manifestHash?: string | null;
  featureVersion?: string | null;
}): Promise<number | null> {
  try {
    const decisionId = crypto.randomUUID();

    // Detect session from current time
    const session = detectSession(new Date());

    // Derive volatility state and spread state from telemetry if present
    const telData = params.request as Record<string, unknown>;
    const spread = typeof telData.spread === "number" ? telData.spread : null;
    const drawdown = typeof telData.drawdown === "number" ? telData.drawdown : null;

    const volatilityState =
      drawdown !== null
        ? drawdown >= 15 ? "EXTREME" : drawdown >= 8 ? "HIGH" : drawdown >= 3 ? "MODERATE" : "LOW"
        : null;
    const spreadState =
      spread !== null
        ? spread >= 3 ? "WIDE" : spread >= 1 ? "NORMAL" : "TIGHT"
        : null;

    const [decision] = await db.insert(qdeDecisionsTable).values({
      decisionId,
      modelVersion: params.response.model_version ?? null,
      symbol: params.symbol,
      userId: params.userId,
      opportunityId: params.opportunityId ?? null,
      telemetryId: params.telemetryId ?? null,
      inferenceType: params.inferenceType,
      direction: params.response.direction ?? null,
      confidence: params.response.confidence ?? null,
      riskSignal: params.response.risk_signal ?? null,
      sizeSignal: params.response.size_signal ?? null,
      entryUrgency: params.response.entry_urgency ?? null,
      exitHorizon: params.response.exit_horizon ?? null,
      session,
      volatilityState,
      spreadState,
      trainerOnline: params.trainerOnline,
      // S21B — deployment traceability
      artifactHash: params.artifactHash ?? null,
      manifestHash: params.manifestHash ?? null,
      featureVersion: params.featureVersion ?? null,
    }).returning();

    // Reasoning record
    await db.insert(decisionReasoningTable).values({
      decisionId: decision.id,
      reasoning: params.response.reasoning,
      primaryPattern: null, // Extracted from reasoning text by trainer later
      warnings: params.response.warnings ?? [],
      rawModelOutput: params.response as Record<string, unknown>,
    });

    // Context record (from the incoming request)
    const reqTelemetry = (params.request as { telemetry?: Record<string, unknown> }).telemetry;
    if (reqTelemetry) {
      await db.insert(decisionContextTable).values({
        decisionId: decision.id,
        balance: typeof reqTelemetry.balance === "number" ? reqTelemetry.balance : null,
        equity: typeof reqTelemetry.equity === "number" ? reqTelemetry.equity : null,
        margin: typeof reqTelemetry.margin === "number" ? reqTelemetry.margin : null,
        freeMargin: typeof reqTelemetry.freeMargin === "number" ? reqTelemetry.freeMargin : null,
        openPositions: typeof reqTelemetry.openPositions === "number" ? reqTelemetry.openPositions : null,
        floatingPnl: typeof reqTelemetry.floatingPnl === "number" ? reqTelemetry.floatingPnl : null,
        entryPrice: typeof reqTelemetry.entryPrice === "number" ? reqTelemetry.entryPrice : null,
        currentPrice: typeof reqTelemetry.currentPrice === "number" ? reqTelemetry.currentPrice : null,
        spread: typeof reqTelemetry.spread === "number" ? reqTelemetry.spread : null,
        drawdown: typeof reqTelemetry.drawdown === "number" ? reqTelemetry.drawdown : null,
        tradeAgeSeconds: typeof reqTelemetry.tradeAgeSeconds === "number" ? reqTelemetry.tradeAgeSeconds : null,
      });
    }

    return decision.id;
  } catch (err) {
    logger.error({ err, symbol: params.symbol }, "Failed to capture QDE decision");
    return null;
  }
}
