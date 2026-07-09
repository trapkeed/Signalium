/**
 * S19 — Trade Intelligence Routes
 *
 * Admin-facing endpoints for observing every layer of trade memory:
 * decisions, reasoning, position snapshots, trade timelines, failure
 * investigations, counterfactual analysis, learning queue, trainer sync,
 * and self-evaluation reports.
 *
 * All routes are admin-only unless noted.
 */

import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db } from "@workspace/db";
import {
  qdeDecisionsTable,
  decisionReasoningTable,
  decisionContextTable,
  executionTelemetryTable,
  executionQualityMetricsTable,
  positionSnapshotsTable,
  positionMetricsTable,
  tradeEventsTable,
  tradeTimelineTable,
  reasoningValidationTable,
  reasoningAccuracyTable,
  tradeFailuresTable,
  failurePatternsTable,
  counterfactualResultsTable,
  learningCandidatesTable,
  selfEvaluationReportsTable,
  trainerSyncStateTable,
  opportunitiesTable,
} from "@workspace/db";
import { eq, desc, asc, and, gte, lte, isNull, isNotNull, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { finaliseExitedTrade } from "../lib/tradeLifecycle";

const router = Router();

// ─── Decisions ────────────────────────────────────────────────────────────────

router.get("/admin/decisions", requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const symbol = req.query.symbol as string | undefined;
  const userId = req.query.userId as string | undefined;

  try {
    const conditions: ReturnType<typeof and>[] = [];
    if (symbol) conditions.push(eq(qdeDecisionsTable.symbol, symbol));
    if (userId) conditions.push(eq(qdeDecisionsTable.userId, userId));

    const rows = await db.select().from(qdeDecisionsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(qdeDecisionsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(qdeDecisionsTable)
      .where(conditions.length ? and(...conditions) : undefined);

    return res.json({ rows, total });
  } catch (err) {
    req.log.error(err, "Failed to list QDE decisions");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/decisions/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [decision] = await db.select().from(qdeDecisionsTable).where(eq(qdeDecisionsTable.id, id));
    if (!decision) return res.status(404).json({ error: "Not found" });

    const [reasoning] = await db.select().from(decisionReasoningTable).where(eq(decisionReasoningTable.decisionId, id));
    const [context] = await db.select().from(decisionContextTable).where(eq(decisionContextTable.decisionId, id));

    return res.json({ decision, reasoning: reasoning ?? null, context: context ?? null });
  } catch (err) {
    req.log.error(err, "Failed to get QDE decision");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Position Snapshots ───────────────────────────────────────────────────────

router.get("/admin/position-snapshots", requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const opportunityId = req.query.opportunityId ? Number(req.query.opportunityId) : undefined;

  try {
    const rows = await db.select().from(positionSnapshotsTable)
      .where(opportunityId ? eq(positionSnapshotsTable.opportunityId, opportunityId) : undefined)
      .orderBy(desc(positionSnapshotsTable.snapshotAt))
      .limit(limit);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list position snapshots");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/position-metrics/:opportunityId", requireAdmin, async (req, res) => {
  const opportunityId = Number(req.params.opportunityId);
  if (isNaN(opportunityId)) return res.status(400).json({ error: "Invalid opportunityId" });

  try {
    const [metrics] = await db.select().from(positionMetricsTable)
      .where(eq(positionMetricsTable.opportunityId, opportunityId));
    if (!metrics) return res.status(404).json({ error: "No metrics found for this opportunity" });
    return res.json(metrics);
  } catch (err) {
    req.log.error(err, "Failed to get position metrics");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Trade Events ─────────────────────────────────────────────────────────────

router.get("/admin/trade-events", requireAdmin, async (req, res) => {
  const opportunityId = req.query.opportunityId ? Number(req.query.opportunityId) : undefined;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);

  try {
    const rows = await db.select().from(tradeEventsTable)
      .where(opportunityId ? eq(tradeEventsTable.opportunityId, opportunityId) : undefined)
      .orderBy(asc(tradeEventsTable.occurredAt))
      .limit(limit);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list trade events");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Trade Timeline ───────────────────────────────────────────────────────────

router.get("/admin/trade-timeline", requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const symbol = req.query.symbol as string | undefined;
  const outcome = req.query.outcome as string | undefined;

  try {
    const conditions: ReturnType<typeof and>[] = [];
    if (symbol) conditions.push(eq(tradeTimelineTable.symbol, symbol));
    if (outcome) conditions.push(eq(tradeTimelineTable.outcome, outcome));

    const rows = await db.select().from(tradeTimelineTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(tradeTimelineTable.exitAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(tradeTimelineTable)
      .where(conditions.length ? and(...conditions) : undefined);

    return res.json({ rows, total });
  } catch (err) {
    req.log.error(err, "Failed to list trade timelines");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/trade-timeline/:opportunityId", requireAdmin, async (req, res) => {
  const opportunityId = Number(req.params.opportunityId);
  if (isNaN(opportunityId)) return res.status(400).json({ error: "Invalid opportunityId" });

  try {
    const [opp] = await db.select().from(opportunitiesTable).where(eq(opportunitiesTable.id, opportunityId));
    const [timeline] = await db.select().from(tradeTimelineTable).where(eq(tradeTimelineTable.opportunityId, opportunityId));
    const events = await db.select().from(tradeEventsTable)
      .where(eq(tradeEventsTable.opportunityId, opportunityId))
      .orderBy(asc(tradeEventsTable.occurredAt));
    const [metrics] = await db.select().from(positionMetricsTable).where(eq(positionMetricsTable.opportunityId, opportunityId));
    const decisions = await db.select().from(qdeDecisionsTable).where(eq(qdeDecisionsTable.opportunityId, opportunityId));
    const [validation] = await db.select().from(reasoningValidationTable).where(eq(reasoningValidationTable.opportunityId, opportunityId));
    const counterfactuals = await db.select().from(counterfactualResultsTable).where(eq(counterfactualResultsTable.opportunityId, opportunityId));
    const [failure] = await db.select().from(tradeFailuresTable).where(eq(tradeFailuresTable.opportunityId, opportunityId));

    return res.json({ opportunity: opp ?? null, timeline: timeline ?? null, events, metrics: metrics ?? null, decisions, validation: validation ?? null, counterfactuals, failure: failure ?? null });
  } catch (err) {
    req.log.error(err, "Failed to get trade timeline");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Manually trigger finalisation for a specific opportunity (admin utility)
router.post("/admin/trade-timeline/:opportunityId/finalize", requireAdmin, async (req, res) => {
  const opportunityId = Number(req.params.opportunityId);
  if (isNaN(opportunityId)) return res.status(400).json({ error: "Invalid opportunityId" });

  try {
    await finaliseExitedTrade(opportunityId);
    const [timeline] = await db.select().from(tradeTimelineTable).where(eq(tradeTimelineTable.opportunityId, opportunityId));
    return res.json({ ok: true, timeline: timeline ?? null });
  } catch (err) {
    req.log.error(err, "Failed to finalize trade");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Reasoning Validation ─────────────────────────────────────────────────────

router.get("/admin/reasoning-validation", requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const unvalidatedOnly = req.query.unvalidated === "true";

  try {
    const rows = await db.select().from(reasoningValidationTable)
      .where(unvalidatedOnly ? isNull(reasoningValidationTable.wasCorrect) : undefined)
      .orderBy(desc(reasoningValidationTable.createdAt))
      .limit(limit);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list reasoning validations");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/reasoning-validation/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { wasCorrect, actualPattern, correctnessScore, validatorNote } = req.body as {
    wasCorrect?: boolean;
    actualPattern?: string;
    correctnessScore?: number;
    validatorNote?: string;
  };

  try {
    const [updated] = await db.update(reasoningValidationTable)
      .set({
        wasCorrect: wasCorrect ?? null,
        actualPattern: actualPattern ?? null,
        correctnessScore: correctnessScore ?? null,
        validatorNote: validatorNote ?? null,
        validatedAt: new Date(),
      })
      .where(eq(reasoningValidationTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });

    // Update reasoning_accuracy aggregate
    if (updated.initialPattern && wasCorrect !== undefined) {
      await db.insert(reasoningAccuracyTable).values({
        pattern: updated.initialPattern,
        symbol: updated.symbol,
        session: "*",
        totalPredictions: 1,
        correctPredictions: wasCorrect ? 1 : 0,
        accuracyRate: wasCorrect ? 1 : 0,
      }).onConflictDoUpdate({
        target: [reasoningAccuracyTable.pattern, reasoningAccuracyTable.symbol, reasoningAccuracyTable.session],
        set: {
          totalPredictions: sql`${reasoningAccuracyTable.totalPredictions} + 1`,
          correctPredictions: sql`${reasoningAccuracyTable.correctPredictions} + ${wasCorrect ? 1 : 0}`,
          accuracyRate: sql`(${reasoningAccuracyTable.correctPredictions} + ${wasCorrect ? 1 : 0})::real / (${reasoningAccuracyTable.totalPredictions} + 1)`,
          lastUpdatedAt: new Date(),
        },
      });
    }

    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to update reasoning validation");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/reasoning-accuracy", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(reasoningAccuracyTable)
      .orderBy(desc(reasoningAccuracyTable.totalPredictions));
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list reasoning accuracy");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Trade Failures ───────────────────────────────────────────────────────────

router.get("/admin/trade-failures", requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const symbol = req.query.symbol as string | undefined;

  try {
    const rows = await db.select().from(tradeFailuresTable)
      .where(symbol ? eq(tradeFailuresTable.symbol, symbol) : undefined)
      .orderBy(desc(tradeFailuresTable.createdAt))
      .limit(limit);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list trade failures");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/trade-failures/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { rootCause, adminNotes, positionManagementIssues } = req.body as {
    rootCause?: string;
    adminNotes?: string;
    positionManagementIssues?: string[];
  };

  try {
    const [updated] = await db.update(tradeFailuresTable)
      .set({
        rootCause: rootCause ?? undefined,
        adminNotes: adminNotes ?? undefined,
        positionManagementIssues: positionManagementIssues ?? undefined,
        investigatedAt: new Date(),
      })
      .where(eq(tradeFailuresTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to update trade failure");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/failure-patterns", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(failurePatternsTable)
      .orderBy(desc(failurePatternsTable.occurrences));
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list failure patterns");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Counterfactuals ──────────────────────────────────────────────────────────

router.get("/admin/counterfactuals", requireAdmin, async (req, res) => {
  const opportunityId = req.query.opportunityId ? Number(req.query.opportunityId) : undefined;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);

  try {
    const rows = await db.select().from(counterfactualResultsTable)
      .where(opportunityId ? eq(counterfactualResultsTable.opportunityId, opportunityId) : undefined)
      .orderBy(desc(counterfactualResultsTable.generatedAt))
      .limit(limit);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list counterfactuals");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Learning Queue ───────────────────────────────────────────────────────────

router.get("/admin/learning-queue", requireAdmin, async (req, res) => {
  const processedOnly = req.query.processed === "true";
  const limit = Math.min(Number(req.query.limit) || 200, 1000);

  try {
    const rows = await db.select().from(learningCandidatesTable)
      .where(processedOnly ? eq(learningCandidatesTable.processedByTrainer, true) : eq(learningCandidatesTable.processedByTrainer, false))
      .orderBy(desc(learningCandidatesTable.priority), asc(learningCandidatesTable.createdAt))
      .limit(limit);

    const [{ unprocessed }] = await db.select({ unprocessed: sql<number>`count(*)::int` })
      .from(learningCandidatesTable)
      .where(eq(learningCandidatesTable.processedByTrainer, false));

    return res.json({ rows, unprocessed });
  } catch (err) {
    req.log.error(err, "Failed to list learning queue");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/learning-queue/:id/mark-processed", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [updated] = await db.update(learningCandidatesTable)
      .set({ processedByTrainer: true, processedAt: new Date() })
      .where(eq(learningCandidatesTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to mark learning candidate as processed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Execution Quality ────────────────────────────────────────────────────────

router.get("/admin/execution-quality", requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);

  try {
    const rows = await db.select().from(executionQualityMetricsTable)
      .orderBy(desc(executionQualityMetricsTable.sampleCount))
      .limit(limit);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list execution quality metrics");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/execution-telemetry", requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const symbol = req.query.symbol as string | undefined;

  try {
    const rows = await db.select().from(executionTelemetryTable)
      .where(symbol ? eq(executionTelemetryTable.symbol, symbol) : undefined)
      .orderBy(desc(executionTelemetryTable.createdAt))
      .limit(limit);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list execution telemetry");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Trainer Sync ─────────────────────────────────────────────────────────────

router.get("/trainer-sync/status", requireAdmin, async (req, res) => {
  try {
    const [state] = await db.select().from(trainerSyncStateTable).where(eq(trainerSyncStateTable.id, "global"));
    return res.json(state ?? { id: "global", lastSyncAt: null, lastSyncStatus: null, decisionsExported: 0, timelinesExported: 0, executionsExported: 0, candidatesExported: 0, totalSyncs: 0 });
  } catch (err) {
    req.log.error(err, "Failed to get trainer sync status");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/trainer-sync", requireAdmin, async (req, res) => {
  const trainerUrl = process.env["QDE_TRAINER_URL"];

  try {
    // Get last *successful* sync timestamp — only advances on confirmed trainer ack
    const [syncState] = await db.select().from(trainerSyncStateTable).where(eq(trainerSyncStateTable.id, "global"));
    const lastSyncAt = syncState?.lastSyncAt ?? new Date(0);

    // Collect everything since last confirmed sync
    const [decisions, timelines, executions, candidates] = await Promise.all([
      db.select().from(qdeDecisionsTable).where(gte(qdeDecisionsTable.createdAt, lastSyncAt)).limit(1000),
      db.select().from(tradeTimelineTable).where(gte(tradeTimelineTable.createdAt, lastSyncAt)).limit(1000),
      db.select().from(executionTelemetryTable).where(gte(executionTelemetryTable.createdAt, lastSyncAt)).limit(1000),
      // Only unprocessed candidates — independent of the time cursor so none are skipped
      db.select().from(learningCandidatesTable).where(eq(learningCandidatesTable.processedByTrainer, false)).limit(500),
    ]);

    const countSummary = `${decisions.length} decisions, ${timelines.length} timelines, ${executions.length} executions, ${candidates.length} candidates`;

    // ── Determine whether ingestion succeeded ───────────────────────────────
    let syncStatus: "ok" | "error" | "offline";
    let syncMessage: string;
    let trainerAcknowledged = false;

    if (!trainerUrl) {
      // Trainer not configured — data stays in queue, cursor does NOT advance
      syncStatus = "offline";
      syncMessage = `[Trainer offline] Batch staged but not delivered: ${countSummary}`;
      trainerAcknowledged = false;
    } else {
      const payload = {
        syncedAt: new Date().toISOString(),
        decisions,
        timelines,
        executions,
        learningCandidates: candidates,
      };
      try {
        const trainerRes = await fetch(`${trainerUrl.replace(/\/$/, "")}/batch-learn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });
        if (trainerRes.ok) {
          syncStatus = "ok";
          syncMessage = `Exported ${countSummary}`;
          trainerAcknowledged = true;
        } else {
          syncStatus = "error";
          syncMessage = `Trainer returned ${trainerRes.status} — cursor not advanced, retry will resend`;
          trainerAcknowledged = false;
        }
      } catch (fetchErr) {
        syncStatus = "error";
        syncMessage = `Trainer unreachable — cursor not advanced, retry will resend`;
        trainerAcknowledged = false;
        req.log.warn({ fetchErr }, "Trainer fetch failed");
      }
    }

    // ── Commit side-effects only on confirmed ingestion ─────────────────────
    if (trainerAcknowledged) {
      // Advance cursor — subsequent syncs won't re-send already-ingested records
      const now = new Date();
      if (candidates.length > 0) {
        const candidateIds = candidates.map((c) => c.id);
        // Bulk update — single statement, no N+1
        await db.update(learningCandidatesTable)
          .set({ processedByTrainer: true, processedAt: now })
          .where(sql`${learningCandidatesTable.id} = ANY(${candidateIds})`);
      }
      // Update sync state with new cursor
      await db.insert(trainerSyncStateTable).values({
        id: "global",
        lastSyncAt: now,
        lastSyncStatus: syncStatus,
        lastSyncMessage: syncMessage,
        decisionsExported: decisions.length,
        timelinesExported: timelines.length,
        executionsExported: executions.length,
        candidatesExported: candidates.length,
        totalSyncs: 1,
      }).onConflictDoUpdate({
        target: trainerSyncStateTable.id,
        set: {
          lastSyncAt: now,          // cursor advances only here
          lastSyncStatus: syncStatus,
          lastSyncMessage: syncMessage,
          decisionsExported: decisions.length,
          timelinesExported: timelines.length,
          executionsExported: executions.length,
          candidatesExported: candidates.length,
          totalSyncs: sql`${trainerSyncStateTable.totalSyncs} + 1`,
          updatedAt: now,
        },
      });
    } else {
      // Record the failure/offline status without touching the cursor or candidates
      await db.insert(trainerSyncStateTable).values({
        id: "global",
        lastSyncAt: syncState?.lastSyncAt ?? null,
        lastSyncStatus: syncStatus,
        lastSyncMessage: syncMessage,
        decisionsExported: 0,
        timelinesExported: 0,
        executionsExported: 0,
        candidatesExported: 0,
        totalSyncs: 0,
      }).onConflictDoUpdate({
        target: trainerSyncStateTable.id,
        set: {
          // lastSyncAt intentionally NOT updated — cursor stays at last success
          lastSyncStatus: syncStatus,
          lastSyncMessage: syncMessage,
          updatedAt: new Date(),
        },
      });
    }

    return res.json({
      ok: trainerAcknowledged,
      status: syncStatus,
      message: syncMessage,
      counts: { decisions: decisions.length, timelines: timelines.length, executions: executions.length, candidates: candidates.length },
    });
  } catch (err) {
    req.log.error(err, "Trainer sync failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Self-Evaluation Reports ──────────────────────────────────────────────────

router.get("/self-evaluation", requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const reportType = req.query.reportType as string | undefined;

  try {
    const rows = await db.select().from(selfEvaluationReportsTable)
      .where(reportType ? eq(selfEvaluationReportsTable.reportType, reportType) : undefined)
      .orderBy(desc(selfEvaluationReportsTable.periodEnd))
      .limit(limit);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list self-evaluation reports");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/self-evaluation/generate", requireAdmin, async (req, res) => {
  const { reportType, periodEnd } = req.body as {
    reportType?: "daily" | "weekly" | "monthly";
    periodEnd?: string;
  };

  if (!reportType || !["daily", "weekly", "monthly"].includes(reportType)) {
    return res.status(400).json({ error: "'reportType' must be daily, weekly, or monthly" });
  }

  const endDate = periodEnd ? new Date(periodEnd) : new Date();
  const startDate = new Date(endDate);
  if (reportType === "daily") startDate.setDate(endDate.getDate() - 1);
  else if (reportType === "weekly") startDate.setDate(endDate.getDate() - 7);
  else startDate.setMonth(endDate.getMonth() - 1);

  try {
    // Query trade timelines for the period
    const timelines = await db.select().from(tradeTimelineTable)
      .where(and(gte(tradeTimelineTable.exitAt, startDate), lte(tradeTimelineTable.exitAt, endDate)));

    const totalTrades = timelines.length;
    const wins = timelines.filter((t) => t.outcome === "win").length;
    const losses = timelines.filter((t) => t.outcome === "loss").length;
    const winRate = totalTrades > 0 ? wins / totalTrades : null;

    const rMultiples = timelines.filter((t) => t.rMultiple !== null).map((t) => t.rMultiple!);
    const avgRMultiple = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : null;
    const bestRMultiple = rMultiples.length > 0 ? Math.max(...rMultiples) : null;
    const worstRMultiple = rMultiples.length > 0 ? Math.min(...rMultiples) : null;

    // Sharpe: mean R / std R (simplified, annualised by period)
    let sharpeRatio: number | null = null;
    if (rMultiples.length >= 2) {
      const mean = avgRMultiple!;
      const variance = rMultiples.reduce((s, r) => s + (r - mean) ** 2, 0) / rMultiples.length;
      const stdDev = Math.sqrt(variance);
      sharpeRatio = stdDev > 0 ? mean / stdDev : null;
    }

    // Best/worst symbol by win rate
    const symbolStats = new Map<string, { wins: number; total: number; pnl: number }>();
    for (const t of timelines) {
      const s = symbolStats.get(t.symbol) ?? { wins: 0, total: 0, pnl: 0 };
      s.total++;
      if (t.outcome === "win") s.wins++;
      s.pnl += t.finalPnl ?? 0;
      symbolStats.set(t.symbol, s);
    }
    let bestSymbol: string | null = null, worstSymbol: string | null = null;
    let bestPnl = -Infinity, worstPnl = Infinity;
    for (const [sym, stats] of symbolStats) {
      if (stats.pnl > bestPnl) { bestPnl = stats.pnl; bestSymbol = sym; }
      if (stats.pnl < worstPnl) { worstPnl = stats.pnl; worstSymbol = sym; }
    }

    // Best/worst session
    const sessionStats = new Map<string, { wins: number; total: number; pnl: number }>();
    for (const t of timelines) {
      const sess = t.session ?? "UNKNOWN";
      const s = sessionStats.get(sess) ?? { wins: 0, total: 0, pnl: 0 };
      s.total++;
      if (t.outcome === "win") s.wins++;
      s.pnl += t.finalPnl ?? 0;
      sessionStats.set(sess, s);
    }
    let bestSession: string | null = null, worstSession: string | null = null;
    let bestSPnl = -Infinity, worstSPnl = Infinity;
    for (const [sess, stats] of sessionStats) {
      if (stats.pnl > bestSPnl) { bestSPnl = stats.pnl; bestSession = sess; }
      if (stats.pnl < worstSPnl) { worstSPnl = stats.pnl; worstSession = sess; }
    }

    // Reasoning accuracy from the table
    const [accuracyRow] = await db.select({ avg: sql<number>`avg(accuracy_rate)::real` })
      .from(reasoningAccuracyTable);
    const reasoningAccuracy = accuracyRow?.avg ?? null;

    // Insights
    const insights: string[] = [];
    if (winRate !== null && winRate < 0.4) insights.push(`Win rate (${(winRate * 100).toFixed(0)}%) is below 40% — review setup quality criteria`);
    if (avgRMultiple !== null && avgRMultiple < 0) insights.push(`Average R-multiple is negative (${avgRMultiple.toFixed(2)}) — risk management needs review`);
    if (worstSymbol) insights.push(`${worstSymbol} produced the worst P/L this period — consider reduced exposure`);
    if (bestSymbol) insights.push(`${bestSymbol} was the most profitable symbol — strong edge here`);
    if (worstSession) insights.push(`${worstSession} session underperformed — consider avoiding it`);
    if (reasoningAccuracy !== null && reasoningAccuracy < 0.5) insights.push(`Reasoning accuracy ${(reasoningAccuracy * 100).toFixed(0)}% is below 50% — model explanations are unreliable`);
    if (insights.length === 0) insights.push("Performance within normal parameters. No critical concerns detected.");

    const [report] = await db.insert(selfEvaluationReportsTable).values({
      reportType,
      periodStart: startDate,
      periodEnd: endDate,
      totalTrades,
      wins,
      losses,
      winRate,
      avgRMultiple,
      bestRMultiple,
      worstRMultiple,
      sharpeRatio,
      bestSymbol,
      worstSymbol,
      bestSession,
      worstSession,
      reasoningAccuracy,
      insights,
      rawData: { symbolStats: Object.fromEntries(symbolStats), sessionStats: Object.fromEntries(sessionStats) },
    }).returning();

    return res.status(201).json(report);
  } catch (err) {
    req.log.error(err, "Failed to generate self-evaluation report");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Analytics ────────────────────────────────────────────────────────────────

router.get("/analytics/sessions", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select({
      session: tradeTimelineTable.session,
      totalTrades: sql<number>`count(*)::int`,
      wins: sql<number>`sum(case when outcome = 'win' then 1 else 0 end)::int`,
      losses: sql<number>`sum(case when outcome = 'loss' then 1 else 0 end)::int`,
      winRate: sql<number>`avg(case when outcome = 'win' then 1.0 else 0.0 end)::real`,
      avgRMultiple: sql<number>`avg(r_multiple)::real`,
      totalPnl: sql<number>`sum(final_pnl)::real`,
    })
      .from(tradeTimelineTable)
      .groupBy(tradeTimelineTable.session)
      .orderBy(desc(sql`sum(final_pnl)`));
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to get session analytics");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/analytics/symbols", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select({
      symbol: tradeTimelineTable.symbol,
      totalTrades: sql<number>`count(*)::int`,
      wins: sql<number>`sum(case when outcome = 'win' then 1 else 0 end)::int`,
      losses: sql<number>`sum(case when outcome = 'loss' then 1 else 0 end)::int`,
      winRate: sql<number>`avg(case when outcome = 'win' then 1.0 else 0.0 end)::real`,
      avgRMultiple: sql<number>`avg(r_multiple)::real`,
      totalPnl: sql<number>`sum(final_pnl)::real`,
      avgDurationSeconds: sql<number>`avg(duration_seconds)::real`,
    })
      .from(tradeTimelineTable)
      .groupBy(tradeTimelineTable.symbol)
      .orderBy(desc(sql`sum(final_pnl)`));
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to get symbol analytics");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/analytics/confidence-reliability", requireAdmin, async (req, res) => {
  try {
    // Bucket confidence readings and compute win rate per bucket
    const rows = await db.select({
      decisionId: qdeDecisionsTable.id,
      confidence: qdeDecisionsTable.confidence,
      symbol: qdeDecisionsTable.symbol,
      opportunityId: qdeDecisionsTable.opportunityId,
      outcome: tradeTimelineTable.outcome,
    })
      .from(qdeDecisionsTable)
      .innerJoin(tradeTimelineTable, eq(tradeTimelineTable.opportunityId, qdeDecisionsTable.opportunityId))
      .where(isNotNull(qdeDecisionsTable.confidence));

    // Compute bucket stats
    const buckets: Record<string, { total: number; wins: number; minConf: number; maxConf: number }> = {};
    for (const r of rows) {
      if (r.confidence === null) continue;
      const bucket = `${Math.floor(r.confidence * 10) * 10}-${Math.floor(r.confidence * 10) * 10 + 10}`;
      const b = buckets[bucket] ?? { total: 0, wins: 0, minConf: r.confidence, maxConf: r.confidence };
      b.total++;
      if (r.outcome === "win") b.wins++;
      b.minConf = Math.min(b.minConf, r.confidence);
      b.maxConf = Math.max(b.maxConf, r.confidence);
      buckets[bucket] = b;
    }

    const result = Object.entries(buckets).map(([bucket, stats]) => ({
      bucket,
      total: stats.total,
      wins: stats.wins,
      winRate: stats.total > 0 ? stats.wins / stats.total : 0,
    })).sort((a, b) => a.bucket.localeCompare(b.bucket));

    return res.json(result);
  } catch (err) {
    req.log.error(err, "Failed to get confidence reliability");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/analytics/reasoning-accuracy", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(reasoningAccuracyTable)
      .where(isNotNull(reasoningAccuracyTable.accuracyRate))
      .orderBy(desc(reasoningAccuracyTable.totalPredictions));
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to get reasoning accuracy analytics");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/analytics/model-quality", requireAdmin, async (req, res) => {
  try {
    // Rolling 7-day model quality: win rate, avg confidence, reasoning accuracy
    const rows = await db.select({
      week: sql<string>`date_trunc('week', exit_at)::text`,
      totalTrades: sql<number>`count(*)::int`,
      winRate: sql<number>`avg(case when outcome = 'win' then 1.0 else 0.0 end)::real`,
      avgRMultiple: sql<number>`avg(r_multiple)::real`,
      sharpe: sql<number>`case when stddev(r_multiple) > 0 then avg(r_multiple)::real / stddev(r_multiple)::real else null end`,
    })
      .from(tradeTimelineTable)
      .where(isNotNull(tradeTimelineTable.exitAt))
      .groupBy(sql`date_trunc('week', exit_at)`)
      .orderBy(asc(sql`date_trunc('week', exit_at)`))
      .limit(52);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to get model quality analytics");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/analytics/execution-quality", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(executionQualityMetricsTable)
      .orderBy(desc(executionQualityMetricsTable.sampleCount));
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to get execution quality analytics");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Overview stats for Trade Intelligence dashboard ─────────────────────────

router.get("/admin/trade-intelligence-stats", requireAdmin, async (req, res) => {
  try {
    const [decisionsCount] = await db.select({ count: sql<number>`count(*)::int` }).from(qdeDecisionsTable);
    const [timelinesCount] = await db.select({ count: sql<number>`count(*)::int` }).from(tradeTimelineTable);
    const [failuresCount] = await db.select({ count: sql<number>`count(*)::int` }).from(tradeFailuresTable);
    const [queueCount] = await db.select({ count: sql<number>`count(*)::int` }).from(learningCandidatesTable).where(eq(learningCandidatesTable.processedByTrainer, false));
    const [validationPending] = await db.select({ count: sql<number>`count(*)::int` }).from(reasoningValidationTable).where(isNull(reasoningValidationTable.wasCorrect));
    const [syncState] = await db.select().from(trainerSyncStateTable).where(eq(trainerSyncStateTable.id, "global"));

    const [overallStats] = await db.select({
      winRate: sql<number>`avg(case when outcome = 'win' then 1.0 else 0.0 end)::real`,
      avgRMultiple: sql<number>`avg(r_multiple)::real`,
      totalPnl: sql<number>`sum(final_pnl)::real`,
    }).from(tradeTimelineTable);

    return res.json({
      decisions: decisionsCount.count,
      timelines: timelinesCount.count,
      failures: failuresCount.count,
      learningQueueDepth: queueCount.count,
      validationPending: validationPending.count,
      lastTrainerSync: syncState?.lastSyncAt ?? null,
      trainerSyncStatus: syncState?.lastSyncStatus ?? null,
      overall: {
        winRate: overallStats?.winRate ?? null,
        avgRMultiple: overallStats?.avgRMultiple ?? null,
        totalPnl: overallStats?.totalPnl ?? null,
      },
    });
  } catch (err) {
    req.log.error(err, "Failed to get trade intelligence stats");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
