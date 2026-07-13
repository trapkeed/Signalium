/**
 * S18 — Inference Gateway Routes
 *
 * These routes are the API gateway between the Signalium platform and the
 * signalium-trainer service. Signalium contains NO business/inference logic —
 * it builds a snapshot from available data and forwards the request to the
 * trainer (QDE_TRAINER_URL). When the trainer is offline it falls back to the
 * existing heuristic simulator so the platform never hard-fails.
 *
 * Endpoints:
 *   POST /qde/inference         — full market inference for a symbol
 *   POST /qde/review-position   — re-evaluate an open position
 *   POST /qde/manual-analysis   — user-triggered on-demand analysis
 *   POST /qde/portfolio-review  — cross-symbol portfolio review
 *   POST /qde/reasoning         — model reasoning for a specific setup
 *
 * Admin controls:
 *   GET  /qde/admin/inference-controls
 *   PUT  /qde/admin/inference-controls
 *
 * Opportunity state machine:
 *   GET  /qde/opportunities
 *   GET  /qde/opportunities/:id
 *   GET  /qde/admin/opportunities
 *   POST /qde/admin/opportunities/:id/transition
 *
 * Market memory:
 *   GET  /qde/admin/market-memory
 *   POST /qde/admin/market-memory
 */

import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db } from "@workspace/db";
import {
  opportunitiesTable,
  marketMemoryTable,
  inferenceControlsTable,
  positionTelemetryTable,
  type Opportunity,
} from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { checkApiAccess, checkAutonomousAccess } from "../lib/entitlementEngine";
import { callTrainerInference, type InferenceRequest, type InferenceResponse } from "../lib/qdeTrainer";
import { logAudit } from "../lib/auditLog";
import { captureQdeDecision, emitTradeEvent, finaliseExitedTrade, finaliseExitedTradeSafe } from "../lib/tradeLifecycle";
import { deploymentManager } from "../lib/deploymentManager";
import { getActiveProvider } from "../lib/marketData/registry";
import { getOandaStreamPrice } from "../lib/marketData/oandaStream";
import { isQdeActiveForUser } from "../lib/qdeSwitch";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getInferenceControls() {
  const [row] = await db
    .select()
    .from(inferenceControlsTable)
    .where(eq(inferenceControlsTable.id, "global"));
  return (
    row ?? {
      id: "global",
      inferenceEnabled: true,
      autonomousPaused: false,
      forcedModelVersion: null,
      liveProviderId: null,
      fallbackProviderId: null,
      updatedAt: new Date(),
      updatedBy: null,
    }
  );
}

async function ensureInferenceAllowed(userId: string): Promise<{ allowed: true } | { allowed: false; code: string; message: string }> {
  const apiAccess = await checkApiAccess(userId);
  if (!apiAccess.allowed) return apiAccess;

  const controls = await getInferenceControls();
  if (!controls.inferenceEnabled) {
    return { allowed: false, code: "INFERENCE_DISABLED", message: "Inference is currently disabled by an administrator." };
  }

  return { allowed: true };
}

/** Pull the most recent telemetry row for the user (or a specific symbol). */
async function getLatestTelemetry(userId: string, symbol?: string) {
  const conditions = [eq(positionTelemetryTable.userId, userId)];
  if (symbol) conditions.push(eq(positionTelemetryTable.symbol, symbol));
  const [row] = await db
    .select()
    .from(positionTelemetryTable)
    .where(and(...conditions))
    .orderBy(desc(positionTelemetryTable.receivedAt))
    .limit(1);
  return row ?? null;
}

// ─── POST /qde/inference ─────────────────────────────────────────────────────

router.post("/inference", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const gate = await ensureInferenceAllowed(userId);
  if (!gate.allowed) return res.status(403).json({ error: gate.message, code: gate.code });

  const { symbol } = req.body as { symbol?: string };
  if (!symbol) return res.status(400).json({ error: "'symbol' is required" });

  const latestTelemetry = await getLatestTelemetry(userId, symbol);

  // S21B: resolve active deployment for version pinning and traceability
  const activeMeta = deploymentManager.getActiveMeta();

  // OANDA stream price hydration: if telemetry has no currentPrice (EA
  // offline or no open position), supplement from the live OANDA stream cache.
  // This gives the trainer a real market price even when the EA is disconnected.
  let oandaCurrentPrice: number | null = null;
  if (!latestTelemetry?.currentPrice) {
    const streamPrice = getOandaStreamPrice(symbol);
    if (streamPrice) oandaCurrentPrice = streamPrice.mid;
  }

  const request: InferenceRequest = {
    type: "inference",
    symbol,
    userId,
    targetModelVersion: activeMeta?.version ?? null,
    telemetry: latestTelemetry
      ? {
          balance: Number(latestTelemetry.balance),
          equity: Number(latestTelemetry.equity),
          margin: Number(latestTelemetry.margin),
          freeMargin: Number(latestTelemetry.freeMargin),
          openPositions: latestTelemetry.openPositions,
          floatingPnl: Number(latestTelemetry.floatingPnl),
          entryPrice: latestTelemetry.entryPrice ? Number(latestTelemetry.entryPrice) : null,
          currentPrice: latestTelemetry.currentPrice
            ? Number(latestTelemetry.currentPrice)
            : oandaCurrentPrice,
          spread: latestTelemetry.spread ? Number(latestTelemetry.spread) : null,
          drawdown: latestTelemetry.drawdown ? Number(latestTelemetry.drawdown) : null,
          tradeAgeSeconds: latestTelemetry.tradeAgeSeconds,
          swap: latestTelemetry.swap ? Number(latestTelemetry.swap) : null,
          commission: latestTelemetry.commission ? Number(latestTelemetry.commission) : null,
        }
      : oandaCurrentPrice
        ? {
            // No EA telemetry at all — provide a minimal snapshot from the stream
            // so the trainer at least has a live price to reason about.
            balance: 0,
            equity: 0,
            margin: 0,
            freeMargin: 0,
            openPositions: 0,
            floatingPnl: 0,
            entryPrice: null,
            currentPrice: oandaCurrentPrice,
            spread: null,
            drawdown: null,
            tradeAgeSeconds: null,
            swap: null,
            commission: null,
          }
        : null,
  };

  try {
    const inferenceStart = Date.now();
    const result = await callTrainerInference(request);
    const inferenceLatency = result.latency_ms ?? (Date.now() - inferenceStart);

    // S21B: record health metrics for the active deployment
    deploymentManager.recordLatency(inferenceLatency);
    if (result.confidence != null) deploymentManager.recordConfidence(result.confidence);

    // Create or update opportunity record
    const [opp] = await db
      .insert(opportunitiesTable)
      .values({
        userId,
        symbol,
        state: "WATCHING",
        direction: result.direction ?? null,
        confidence: result.confidence ?? null,
        currentPrice: request.telemetry?.currentPrice ?? null,
        reasoning: result.reasoning,
        warnings: result.warnings ?? [],
        riskSignal: result.risk_signal ?? null,
        sizeSignal: result.size_signal ?? null,
        entryUrgency: result.entry_urgency ?? null,
        exitHorizon: result.exit_horizon ?? null,
        metadata: result as unknown as Record<string, unknown>,
        lastEvaluatedAt: new Date(),
      })
      .returning();

    // S19 + S21B: capture QDE decision with deployment traceability
    captureQdeDecision({
      userId,
      symbol,
      opportunityId: opp.id,
      telemetryId: latestTelemetry?.id ?? null,
      inferenceType: "inference",
      request: request as unknown as Record<string, unknown>,
      response: result as unknown as {
        direction?: string;
        confidence?: number;
        risk_signal?: string;
        size_signal?: string;
        entry_urgency?: string;
        exit_horizon?: string;
        reasoning: string;
        warnings?: string[];
        model_version?: string;
      },
      trainerOnline: true,
      artifactHash: activeMeta?.artifactHash ?? null,
      manifestHash: activeMeta?.manifestHash ?? null,
      featureVersion: activeMeta?.featureVersion ?? null,
    }).catch(() => {});

    emitTradeEvent({
      userId,
      symbol,
      opportunityId: opp.id,
      eventType: "setup_detected",
      confidence: result.confidence ?? null,
      note: `Setup detected — direction: ${result.direction ?? "neutral"}`,
      metadata: { inferenceType: "inference" },
    }).catch(() => {});

    return res.status(201).json({ inference: result, opportunityId: opp.id });
  } catch (err) {
    req.log.error(err, "Inference gateway error");
    deploymentManager.recordError();
    return res.status(502).json({ error: "Trainer unavailable or returned an invalid response" });
  }
});

// ─── POST /qde/review-position ───────────────────────────────────────────────

router.post("/review-position", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const gate = await ensureInferenceAllowed(userId);
  if (!gate.allowed) return res.status(403).json({ error: gate.message, code: gate.code });

  const autonomousAccess = await checkAutonomousAccess(userId);
  if (!autonomousAccess.allowed) {
    return res.status(403).json({ error: autonomousAccess.message, code: autonomousAccess.code });
  }

  const body = req.body as {
    symbol?: string;
    opportunityId?: number;
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

  if (!body.symbol) return res.status(400).json({ error: "'symbol' is required" });

  // S21B: resolve active deployment for version pinning and traceability
  const activeMeta = deploymentManager.getActiveMeta();

  const request: InferenceRequest = {
    type: "review-position",
    symbol: body.symbol,
    userId,
    targetModelVersion: activeMeta?.version ?? null,
    positionContext: {
      entryPrice: body.entryPrice,
      currentPrice: body.currentPrice,
      profit: body.profit,
      drawdown: body.drawdown,
      duration: body.duration,
      spread: body.spread,
      slippage: body.slippage,
      swap: body.swap,
      commission: body.commission,
    },
  };

  try {
    const inferenceStart = Date.now();
    const result = await callTrainerInference(request);
    deploymentManager.recordLatency(result.latency_ms ?? (Date.now() - inferenceStart));
    if (result.confidence != null) deploymentManager.recordConfidence(result.confidence);

    // Update opportunity if provided
    if (body.opportunityId) {
      await db
        .update(opportunitiesTable)
        .set({
          confidence: result.confidence ?? null,
          reasoning: result.reasoning,
          warnings: result.warnings ?? [],
          lastEvaluatedAt: new Date(),
          metadata: result as unknown as Record<string, unknown>,
        })
        .where(
          and(
            eq(opportunitiesTable.id, body.opportunityId),
            eq(opportunitiesTable.userId, userId),
          ),
        );
    }

    // S19 + S21B: capture position re-evaluation decision with deployment traceability
    if (body.opportunityId) {
      captureQdeDecision({
        userId,
        symbol: body.symbol,
        opportunityId: body.opportunityId,
        telemetryId: null,
        inferenceType: "review-position",
        request: request as unknown as Record<string, unknown>,
        response: result as unknown as {
          direction?: string;
          confidence?: number;
          risk_signal?: string;
          size_signal?: string;
          entry_urgency?: string;
          exit_horizon?: string;
          reasoning: string;
          warnings?: string[];
          model_version?: string;
        },
        trainerOnline: true,
        artifactHash: activeMeta?.artifactHash ?? null,
        manifestHash: activeMeta?.manifestHash ?? null,
        featureVersion: activeMeta?.featureVersion ?? null,
      }).catch(() => {});
    }

    return res.json(result);
  } catch (err) {
    req.log.error(err, "Review-position gateway error");
    deploymentManager.recordError();
    return res.status(502).json({ error: "Trainer unavailable or returned an invalid response" });
  }
});

// ─── POST /qde/manual-analysis ───────────────────────────────────────────────

router.post("/manual-analysis", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const gate = await ensureInferenceAllowed(userId);
  if (!gate.allowed) return res.status(403).json({ error: gate.message, code: gate.code });

  // Per-user QDE start/stop switch: while stopped, this user gets no
  // QDE-driven analysis — a safe no-op response, not an error, since it's a
  // deliberate self-service choice. Other users are unaffected.
  const qdeActive = await isQdeActiveForUser(userId);
  if (!qdeActive) {
    return res.status(200).json({
      reasoning: "QDE is currently stopped for your account. Start QDE from the Trading page to receive analysis.",
      warnings: ["QDE_STOPPED"],
    });
  }

  const { symbol, timeframe, notes } = req.body as {
    symbol?: string;
    timeframe?: string;
    notes?: string;
  };

  if (!symbol) return res.status(400).json({ error: "'symbol' is required" });

  const latestTelemetry = await getLatestTelemetry(userId, symbol);

  const request: InferenceRequest = {
    type: "manual-analysis",
    symbol,
    userId,
    targetModelVersion: deploymentManager.getActiveVersion(),
    timeframe: timeframe ?? "H1",
    notes: notes ?? null,
    telemetry: latestTelemetry
      ? {
          balance: Number(latestTelemetry.balance),
          equity: Number(latestTelemetry.equity),
          margin: Number(latestTelemetry.margin),
          freeMargin: Number(latestTelemetry.freeMargin),
          openPositions: latestTelemetry.openPositions,
          floatingPnl: Number(latestTelemetry.floatingPnl),
          entryPrice: latestTelemetry.entryPrice ? Number(latestTelemetry.entryPrice) : null,
          currentPrice: latestTelemetry.currentPrice ? Number(latestTelemetry.currentPrice) : null,
          spread: latestTelemetry.spread ? Number(latestTelemetry.spread) : null,
          drawdown: latestTelemetry.drawdown ? Number(latestTelemetry.drawdown) : null,
          tradeAgeSeconds: latestTelemetry.tradeAgeSeconds,
          swap: latestTelemetry.swap ? Number(latestTelemetry.swap) : null,
          commission: latestTelemetry.commission ? Number(latestTelemetry.commission) : null,
        }
      : null,
  };

  try {
    const result = await callTrainerInference(request);
    return res.json(result);
  } catch (err) {
    req.log.error(err, "Manual-analysis gateway error");
    deploymentManager.recordError();
    return res.status(502).json({ error: "Trainer unavailable or returned an invalid response" });
  }
});

// ─── POST /qde/portfolio-review ──────────────────────────────────────────────

router.post("/portfolio-review", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const gate = await ensureInferenceAllowed(userId);
  if (!gate.allowed) return res.status(403).json({ error: gate.message, code: gate.code });

  const autonomousAccess = await checkAutonomousAccess(userId);
  if (!autonomousAccess.allowed) {
    return res.status(403).json({ error: autonomousAccess.message, code: autonomousAccess.code });
  }

  // Gather recent telemetry for all the user's active positions
  const recentTelemetry = await db
    .select()
    .from(positionTelemetryTable)
    .where(eq(positionTelemetryTable.userId, userId))
    .orderBy(desc(positionTelemetryTable.receivedAt))
    .limit(50);

  // De-duplicate by symbol keeping the latest per symbol
  const latestBySymbol = new Map<string, typeof recentTelemetry[number]>();
  for (const row of recentTelemetry) {
    if (row.symbol && !latestBySymbol.has(row.symbol)) {
      latestBySymbol.set(row.symbol, row);
    }
  }

  const request: InferenceRequest = {
    type: "portfolio-review",
    userId,
    targetModelVersion: deploymentManager.getActiveVersion(),
    positions: Array.from(latestBySymbol.values()).map((t) => ({
      symbol: t.symbol ?? "UNKNOWN",
      balance: Number(t.balance),
      equity: Number(t.equity),
      openPositions: t.openPositions,
      floatingPnl: Number(t.floatingPnl),
      drawdown: t.drawdown ? Number(t.drawdown) : null,
      entryPrice: t.entryPrice ? Number(t.entryPrice) : null,
      currentPrice: t.currentPrice ? Number(t.currentPrice) : null,
    })),
  };

  try {
    const result = await callTrainerInference(request);
    return res.json(result);
  } catch (err) {
    req.log.error(err, "Portfolio-review gateway error");
    deploymentManager.recordError();
    return res.status(502).json({ error: "Trainer unavailable or returned an invalid response" });
  }
});

// ─── POST /qde/reasoning ─────────────────────────────────────────────────────

router.post("/reasoning", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const gate = await ensureInferenceAllowed(userId);
  if (!gate.allowed) return res.status(403).json({ error: gate.message, code: gate.code });

  const { symbol, opportunityId, question } = req.body as {
    symbol?: string;
    opportunityId?: number;
    question?: string;
  };

  if (!symbol) return res.status(400).json({ error: "'symbol' is required" });

  let opportunityContext: Opportunity | null = null;
  if (opportunityId) {
    const [opp] = await db
      .select()
      .from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.id, opportunityId), eq(opportunitiesTable.userId, userId)));
    opportunityContext = opp ?? null;
  }

  const request: InferenceRequest = {
    type: "reasoning",
    symbol,
    userId,
    targetModelVersion: deploymentManager.getActiveVersion(),
    question: question ?? null,
    opportunityContext: opportunityContext
      ? {
          state: opportunityContext.state,
          direction: opportunityContext.direction ?? undefined,
          confidence: opportunityContext.confidence ?? undefined,
          reasoning: opportunityContext.reasoning ?? undefined,
        }
      : null,
  };

  try {
    const result = await callTrainerInference(request);
    return res.json(result);
  } catch (err) {
    req.log.error(err, "Reasoning gateway error");
    deploymentManager.recordError();
    return res.status(502).json({ error: "Trainer unavailable or returned an invalid response" });
  }
});

// ─── Opportunities — user ─────────────────────────────────────────────────────

router.get("/opportunities", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.userId, userId))
      .orderBy(desc(opportunitiesTable.updatedAt))
      .limit(50);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list opportunities");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/opportunities/:id", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [opp] = await db
      .select()
      .from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.id, id), eq(opportunitiesTable.userId, userId)));
    if (!opp) return res.status(404).json({ error: "Not found" });
    return res.json(opp);
  } catch (err) {
    req.log.error(err, "Failed to get opportunity");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin — inference controls ───────────────────────────────────────────────

router.get("/admin/inference-controls", requireAdmin, async (req, res) => {
  try {
    const controls = await getInferenceControls();
    // Resolve the currently-active live/historical market data providers
    // through the single provider abstraction, so admins see what the
    // liveProviderId pin (or fallback priority ordering) actually resolves to.
    const [activeLiveProvider, activeHistoricalProvider] = await Promise.all([
      getActiveProvider("live"),
      getActiveProvider("historical"),
    ]);
    return res.json({ ...controls, activeLiveProvider, activeHistoricalProvider });
  } catch (err) {
    req.log.error(err, "Failed to get inference controls");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/inference-controls", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const body = req.body as {
    inferenceEnabled?: boolean;
    autonomousPaused?: boolean;
    forcedModelVersion?: string | null;
    liveProviderId?: number | null;
    fallbackProviderId?: number | null;
    autonomousMarketPriority?: string[];
  };

  if (body.autonomousMarketPriority !== undefined) {
    const validEntries = ["EA_FEED", "oanda", "tiingo"];
    if (
      !Array.isArray(body.autonomousMarketPriority) ||
      body.autonomousMarketPriority.length === 0 ||
      body.autonomousMarketPriority.some((e) => typeof e !== "string" || !validEntries.includes(e))
    ) {
      return res.status(400).json({ error: `'autonomousMarketPriority' must be a non-empty array of: ${validEntries.join(", ")}` });
    }
  }

  try {
    const [before] = await db.select().from(inferenceControlsTable).where(eq(inferenceControlsTable.id, "global"));

    const patch: Partial<typeof inferenceControlsTable.$inferInsert> = { updatedBy: userId!, updatedAt: new Date() };
    if (body.inferenceEnabled !== undefined) patch.inferenceEnabled = body.inferenceEnabled;
    if (body.autonomousPaused !== undefined) patch.autonomousPaused = body.autonomousPaused;
    if ("forcedModelVersion" in body) patch.forcedModelVersion = body.forcedModelVersion ?? null;
    if ("liveProviderId" in body) patch.liveProviderId = body.liveProviderId ?? null;
    if ("fallbackProviderId" in body) patch.fallbackProviderId = body.fallbackProviderId ?? null;
    if (body.autonomousMarketPriority !== undefined) patch.autonomousMarketPriority = body.autonomousMarketPriority;

    const [result] = await db
      .insert(inferenceControlsTable)
      .values({ id: "global", ...patch })
      .onConflictDoUpdate({ target: inferenceControlsTable.id, set: patch })
      .returning();

    await logAudit(userId!, "inference_controls.updated", "inference_controls", "global", patch);
    if (body.autonomousMarketPriority !== undefined && JSON.stringify(before?.autonomousMarketPriority) !== JSON.stringify(body.autonomousMarketPriority)) {
      await logAudit(userId!, "autonomous_market_priority.updated", "inference_controls", "global", {
        from: before?.autonomousMarketPriority ?? null,
        to: body.autonomousMarketPriority,
      });
    }
    return res.json(result);
  } catch (err) {
    req.log.error(err, "Failed to update inference controls");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin — opportunities ────────────────────────────────────────────────────

router.get("/admin/opportunities", requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(opportunitiesTable)
      .orderBy(desc(opportunitiesTable.updatedAt))
      .limit(200);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list all opportunities");
    return res.status(500).json({ error: "Internal server error" });
  }
});

const VALID_STATES = [
  "WATCHING",
  "BUILDING_CONTEXT",
  "PREPARING_ENTRY",
  "ENTRY_WINDOW",
  "POSITION_ACTIVE",
  "MANAGING_POSITION",
  "EXIT_PREPARATION",
  "EXITED",
  "COOLDOWN",
] as const;

router.post("/admin/opportunities/:id/transition", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { state, reason } = req.body as { state?: string; reason?: string };
  if (!state || !VALID_STATES.includes(state as (typeof VALID_STATES)[number])) {
    return res.status(400).json({ error: `'state' must be one of: ${VALID_STATES.join(", ")}` });
  }

  try {
    const [opp] = await db.select().from(opportunitiesTable).where(eq(opportunitiesTable.id, id));
    if (!opp) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(opportunitiesTable)
      .set({
        state: state as (typeof VALID_STATES)[number],
        reasoning: reason ? `[Admin override] ${reason}` : opp.reasoning,
        updatedAt: new Date(),
      })
      .where(eq(opportunitiesTable.id, id))
      .returning();

    await logAudit(userId!, "opportunity.state_override", "opportunity", String(id), {
      from: opp.state,
      to: state,
      reason,
    });

    // S19: trigger full trade finalisation pipeline when an opportunity exits
    if (state === "EXITED") {
      void finaliseExitedTradeSafe(id);
    } else {
      // Emit a lifecycle event for other state changes
      emitTradeEvent({
        userId: userId!,
        symbol: opp.symbol,
        opportunityId: id,
        eventType: "state_change",
        note: `State changed ${opp.state} → ${state}${reason ? `: ${reason}` : ""}`,
        metadata: { from: opp.state, to: state },
      }).catch(() => {});
    }

    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to transition opportunity");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin — market memory ────────────────────────────────────────────────────

router.get("/admin/market-memory", requireAdmin, async (req, res) => {
  const { symbol } = req.query as { symbol?: string };
  try {
    const conditions = symbol ? [eq(marketMemoryTable.symbol, symbol)] : [];
    const rows = await db
      .select()
      .from(marketMemoryTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(marketMemoryTable.recordedAt))
      .limit(200);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list market memory");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/market-memory", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const body = req.body as {
    symbol?: string;
    kind?: string;
    description?: string;
    confidence?: number;
    outcome?: string;
    metadata?: unknown;
    expiresAt?: string;
  };

  const VALID_KINDS = ["failed_setup", "successful_setup", "regime_transition", "session_behavior", "volatility_behavior"];
  if (!body.symbol) return res.status(400).json({ error: "'symbol' is required" });
  if (!body.kind || !VALID_KINDS.includes(body.kind)) {
    return res.status(400).json({ error: `'kind' must be one of: ${VALID_KINDS.join(", ")}` });
  }
  if (!body.description) return res.status(400).json({ error: "'description' is required" });

  try {
    const [row] = await db
      .insert(marketMemoryTable)
      .values({
        symbol: body.symbol,
        kind: body.kind as typeof marketMemoryTable.$inferInsert["kind"],
        description: body.description,
        confidence: body.confidence ?? null,
        outcome: body.outcome ?? null,
        metadata: body.metadata ?? null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      })
      .returning();

    await logAudit(userId!, "market_memory.created", "market_memory", String(row.id), {
      symbol: body.symbol,
      kind: body.kind,
    });

    return res.status(201).json(row);
  } catch (err) {
    req.log.error(err, "Failed to create market memory entry");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
