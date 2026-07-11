import { Router } from "express";
import { getAuth } from "../lib/auth";
import {
  db,
  symbolsTable,
  symbolCategoriesTable,
  symbolAliasesTable,
  symbolNormalizationLogTable,
  symbolMappingCacheTable,
  symbolMappingConflictsTable,
  symbolRegexPatternsTable,
  userSymbolsTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requireApiKeyAuth } from "../middlewares/requireApiKeyAuth";
import {
  normalizeSymbol,
  invalidateSymbolCache,
  invalidateRegexPatternCache,
  listSymbolsWithCategories,
  cacheAliasMapping,
} from "../lib/symbolNormalizer";
import { checkUserSymbolLimit } from "../lib/entitlementEngine";
import { resolveAliasesViaTrainer, TrainerMappingUnavailableError } from "../lib/marketData/symbolDiscovery";
import { logAudit } from "../lib/auditLog";

const router = Router();

// ─── EA broker symbol discovery ─────────────────────────────────────────────
// EA install-time (and every 24h thereafter) broker symbol scan. The EA
// posts every raw symbol its broker exposes; we resolve each to a canonical
// Signalium symbol via (in order): local exact/alias lookup, suffix
// stripping, the trainer round-trip, then admin-approved regex fallback.
// Every resolution is cached (symbolMappingCacheTable) with a 24h refresh
// contract communicated back to the EA, and a mapping conflict is logged if
// a raw alias resolves differently than it did last time.
router.post("/discovery", requireApiKeyAuth, async (req, res) => {
  const userId = req.eaAuth!.userId;
  const { brokerName, brokerId, rawSymbols } = req.body as {
    brokerName?: string;
    brokerId?: number;
    rawSymbols?: string[];
  };

  if (!Array.isArray(rawSymbols) || rawSymbols.length === 0) {
    return res.status(400).json({ error: "'rawSymbols' (non-empty string array) is required" });
  }

  try {
    // Tier 1: resolve locally (exact/alias/suffix-strip) first — no need to
    // round-trip to the trainer for symbols we already know.
    const unresolvedAfterLocal: string[] = [];
    const results = new Map<string, { canonicalSymbol: string | null; symbolId: number | null; source: string }>();

    for (const raw of rawSymbols) {
      const local = await normalizeSymbol(raw);
      if (local.resolved) {
        results.set(raw, { canonicalSymbol: local.canonicalSymbol ?? null, symbolId: local.symbolId ?? null, source: local.source ?? "exact" });
      } else {
        unresolvedAfterLocal.push(raw);
      }
    }

    // Tier 2: ask the trainer to resolve whatever's left. Honest fallback —
    // if the trainer isn't configured/reachable, those symbols simply stay
    // unresolved (already tried regex fallback inside normalizeSymbol).
    if (unresolvedAfterLocal.length > 0) {
      try {
        const trainerMappings = await resolveAliasesViaTrainer({ brokerName: brokerName ?? null, rawAliases: unresolvedAfterLocal });
        for (const m of trainerMappings) {
          if (!m.canonicalSymbol) continue;
          const [symbol] = await db.select().from(symbolsTable).where(eq(symbolsTable.canonicalSymbol, m.canonicalSymbol.toUpperCase()));
          if (symbol) {
            results.set(m.rawAlias, { canonicalSymbol: symbol.canonicalSymbol, symbolId: symbol.id, source: "trainer" });
          }
        }
      } catch (err) {
        if (!(err instanceof TrainerMappingUnavailableError)) throw err;
        req.log.warn({ err: err.message }, "Trainer symbol mapping unavailable — leaving unresolved symbols as-is");
      }
    }

    // Persist + conflict-detect every resolution (resolved or not) so admins
    // have full visibility into what this broker/account reports.
    let conflictCount = 0;
    const mappings = [];
    for (const raw of rawSymbols) {
      const resolved = results.get(raw);
      const mappingSource: "trainer" | "regex_fallback" | "local_normalizer" =
        resolved?.source === "trainer" || resolved?.source === "regex_fallback" ? resolved.source : "local_normalizer";
      const { conflict } = await cacheAliasMapping({
        rawAlias: raw,
        brokerId: brokerId ?? null,
        canonicalSymbolId: resolved?.symbolId ?? null,
        mappingSource,
      });
      if (conflict) conflictCount++;

      await db.insert(symbolNormalizationLogTable).values({
        rawInput: raw,
        resolvedSymbolId: resolved?.symbolId ?? null,
        resolved: !!resolved,
        source: "ea",
        userId,
      });

      mappings.push({ rawSymbol: raw, canonicalSymbol: resolved?.canonicalSymbol ?? null, resolved: !!resolved });
    }

    if (conflictCount > 0) {
      await logAudit(userId, "symbol_mapping.conflict_detected", "symbol_discovery", brokerName ?? "unknown-broker", { conflictCount, brokerName });
    }

    await logAudit(userId, "symbol_discovery.synced", "symbol_discovery", brokerName ?? "unknown-broker", {
      scanned: rawSymbols.length,
      resolved: mappings.filter((m) => m.resolved).length,
      conflictCount,
    });

    return res.json({ mappings, refreshAfterHours: 24 });
  } catch (err) {
    req.log.error(err, "Failed to process broker symbol discovery");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── User-facing ────────────────────────────────────────────────────────────

// List all enabled canonical symbols with their categories.
router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const symbols = await listSymbolsWithCategories();
    return res.json(symbols);
  } catch (err) {
    req.log.error(err, "Failed to list symbols");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// List symbol categories.
router.get("/categories", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const categories = await db.select().from(symbolCategoriesTable).orderBy(symbolCategoriesTable.name);
    return res.json(categories);
  } catch (err) {
    req.log.error(err, "Failed to list symbol categories");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Normalize a raw EA/broker/platform symbol string to its canonical form.
// Used by EA telemetry ingestion, the trading platform, and the trainer.
router.post("/normalize", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { input, source } = req.body as { input?: string; source?: string };
  if (!input || typeof input !== "string") {
    return res.status(400).json({ error: "'input' is required" });
  }
  const validSources = ["ea", "platform", "trainer", "admin_test"] as const;
  const normalizedSource = validSources.includes(source as typeof validSources[number]) ? (source as typeof validSources[number]) : "platform";

  try {
    const result = await normalizeSymbol(input);

    await db.insert(symbolNormalizationLogTable).values({
      rawInput: input,
      resolvedSymbolId: result.symbolId ?? null,
      resolved: result.resolved,
      source: normalizedSource,
      userId,
    });

    if (!result.resolved) {
      return res.status(422).json({ error: "Unknown symbol", rawInput: input });
    }
    return res.json({ rawInput: input, canonicalSymbol: result.canonicalSymbol, symbolId: result.symbolId });
  } catch (err) {
    req.log.error(err, "Failed to normalize symbol");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── User symbol subscriptions ───────────────────────────────────────────────

// List symbols the user has selected to monitor.
router.get("/user", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const rows = await db
      .select({
        id: userSymbolsTable.id,
        userId: userSymbolsTable.userId,
        symbolId: userSymbolsTable.symbolId,
        createdAt: userSymbolsTable.createdAt,
        canonicalSymbol: symbolsTable.canonicalSymbol,
        displayName: symbolsTable.displayName,
        enabled: symbolsTable.enabled,
        categoryId: symbolCategoriesTable.id,
        categoryName: symbolCategoriesTable.name,
        categorySlug: symbolCategoriesTable.slug,
      })
      .from(userSymbolsTable)
      .innerJoin(symbolsTable, eq(userSymbolsTable.symbolId, symbolsTable.id))
      .innerJoin(symbolCategoriesTable, eq(symbolsTable.categoryId, symbolCategoriesTable.id))
      .where(eq(userSymbolsTable.userId, userId))
      .orderBy(symbolCategoriesTable.name, symbolsTable.canonicalSymbol);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list user symbols");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Add a symbol to the user's monitored set.
router.post("/user", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { symbolId } = req.body as { symbolId?: number };
  if (!symbolId || typeof symbolId !== "number") {
    return res.status(400).json({ error: "'symbolId' (integer) is required" });
  }

  // Verify symbol exists and is enabled
  const [symbol] = await db
    .select()
    .from(symbolsTable)
    .where(and(eq(symbolsTable.id, symbolId), eq(symbolsTable.enabled, true)));
  if (!symbol) return res.status(404).json({ error: "Symbol not found or disabled" });

  // Check for an existing subscription first — re-adding an already-monitored
  // symbol must return the existing row (idempotent 200) rather than 403.
  const [alreadyExists] = await db
    .select({
      id: userSymbolsTable.id,
      userId: userSymbolsTable.userId,
      symbolId: userSymbolsTable.symbolId,
      createdAt: userSymbolsTable.createdAt,
      canonicalSymbol: symbolsTable.canonicalSymbol,
      displayName: symbolsTable.displayName,
      enabled: symbolsTable.enabled,
      categoryId: symbolCategoriesTable.id,
      categoryName: symbolCategoriesTable.name,
      categorySlug: symbolCategoriesTable.slug,
    })
    .from(userSymbolsTable)
    .innerJoin(symbolsTable, eq(userSymbolsTable.symbolId, symbolsTable.id))
    .innerJoin(symbolCategoriesTable, eq(symbolsTable.categoryId, symbolCategoriesTable.id))
    .where(and(eq(userSymbolsTable.userId, userId), eq(userSymbolsTable.symbolId, symbolId)));

  if (alreadyExists) return res.status(200).json(alreadyExists);

  // Only enforce the plan limit for genuinely new additions
  const access = await checkUserSymbolLimit(userId);
  if (!access.allowed) {
    return res.status(403).json({ error: access.message, code: access.code });
  }

  try {
    const [row] = await db
      .insert(userSymbolsTable)
      .values({ userId, symbolId })
      .returning();

    if (!row) {
      // Shouldn't happen after the duplicate-check above, but guard anyway
      const [existing] = await db
        .select({
          id: userSymbolsTable.id,
          userId: userSymbolsTable.userId,
          symbolId: userSymbolsTable.symbolId,
          createdAt: userSymbolsTable.createdAt,
          canonicalSymbol: symbolsTable.canonicalSymbol,
          displayName: symbolsTable.displayName,
          enabled: symbolsTable.enabled,
          categoryId: symbolCategoriesTable.id,
          categoryName: symbolCategoriesTable.name,
          categorySlug: symbolCategoriesTable.slug,
        })
        .from(userSymbolsTable)
        .innerJoin(symbolsTable, eq(userSymbolsTable.symbolId, symbolsTable.id))
        .innerJoin(symbolCategoriesTable, eq(symbolsTable.categoryId, symbolCategoriesTable.id))
        .where(and(eq(userSymbolsTable.userId, userId), eq(userSymbolsTable.symbolId, symbolId)));
      return res.status(200).json(existing);
    }

    const [full] = await db
      .select({
        id: userSymbolsTable.id,
        userId: userSymbolsTable.userId,
        symbolId: userSymbolsTable.symbolId,
        createdAt: userSymbolsTable.createdAt,
        canonicalSymbol: symbolsTable.canonicalSymbol,
        displayName: symbolsTable.displayName,
        enabled: symbolsTable.enabled,
        categoryId: symbolCategoriesTable.id,
        categoryName: symbolCategoriesTable.name,
        categorySlug: symbolCategoriesTable.slug,
      })
      .from(userSymbolsTable)
      .innerJoin(symbolsTable, eq(userSymbolsTable.symbolId, symbolsTable.id))
      .innerJoin(symbolCategoriesTable, eq(symbolsTable.categoryId, symbolCategoriesTable.id))
      .where(eq(userSymbolsTable.id, row.id));
    return res.status(201).json(full);
  } catch (err) {
    req.log.error(err, "Failed to add user symbol");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Remove a symbol from the user's monitored set.
router.delete("/user/:symbolId", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const symbolId = Number(req.params.symbolId);
  if (!Number.isInteger(symbolId)) {
    return res.status(400).json({ error: "Invalid symbolId" });
  }

  try {
    const [deleted] = await db
      .delete(userSymbolsTable)
      .where(and(eq(userSymbolsTable.userId, userId), eq(userSymbolsTable.symbolId, symbolId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Symbol not in your monitored set" });
    return res.json({ id: deleted.id, symbolId: deleted.symbolId });
  } catch (err) {
    req.log.error(err, "Failed to remove user symbol");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin (must be declared before /:id-style dynamic routes) ─────────────

router.get("/admin/log", requireAdmin, async (req, res) => {
  try {
    const { unresolvedOnly } = req.query;
    const entries = unresolvedOnly === "true"
      ? await db.select().from(symbolNormalizationLogTable).where(eq(symbolNormalizationLogTable.resolved, false)).orderBy(desc(symbolNormalizationLogTable.createdAt)).limit(500)
      : await db.select().from(symbolNormalizationLogTable).orderBy(desc(symbolNormalizationLogTable.createdAt)).limit(500);
    return res.json(entries);
  } catch (err) {
    req.log.error(err, "Failed to fetch symbol normalization log");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/categories", requireAdmin, async (req, res) => {
  const { name, slug } = req.body as { name?: string; slug?: string };
  if (!name || !slug) return res.status(400).json({ error: "'name' and 'slug' are required" });

  try {
    const [category] = await db.insert(symbolCategoriesTable).values({ name, slug }).returning();
    return res.status(201).json(category);
  } catch (err) {
    req.log.error(err, "Failed to create symbol category");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/symbols", requireAdmin, async (req, res) => {
  const { canonicalSymbol, displayName, categoryId, enabled } = req.body as {
    canonicalSymbol?: string;
    displayName?: string;
    categoryId?: number;
    enabled?: boolean;
  };
  if (!canonicalSymbol || !displayName || !categoryId) {
    return res.status(400).json({ error: "'canonicalSymbol', 'displayName', and 'categoryId' are required" });
  }

  try {
    const [symbol] = await db.insert(symbolsTable).values({
      canonicalSymbol: canonicalSymbol.toUpperCase(),
      displayName,
      categoryId,
      enabled: enabled ?? true,
    }).returning();
    invalidateSymbolCache();
    return res.status(201).json(symbol);
  } catch (err) {
    req.log.error(err, "Failed to create symbol");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/symbols/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { displayName, categoryId, enabled } = req.body as { displayName?: string; categoryId?: number; enabled?: boolean };

  try {
    const [symbol] = await db.update(symbolsTable)
      .set({ ...(displayName !== undefined && { displayName }), ...(categoryId !== undefined && { categoryId }), ...(enabled !== undefined && { enabled }) })
      .where(eq(symbolsTable.id, id))
      .returning();
    if (!symbol) return res.status(404).json({ error: "Not found" });
    invalidateSymbolCache();
    return res.json(symbol);
  } catch (err) {
    req.log.error(err, "Failed to update symbol");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/symbols/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.delete(symbolAliasesTable).where(eq(symbolAliasesTable.symbolId, id));
    const [deleted] = await db.delete(symbolsTable).where(eq(symbolsTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    invalidateSymbolCache();
    return res.json(deleted);
  } catch (err) {
    req.log.error(err, "Failed to delete symbol");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// List all aliases (with their canonical symbol) for admin management.
router.get("/admin/aliases", requireAdmin, async (req, res) => {
  try {
    const aliases = await db.select({
      id: symbolAliasesTable.id,
      alias: symbolAliasesTable.alias,
      source: symbolAliasesTable.source,
      brokerId: symbolAliasesTable.brokerId,
      createdBy: symbolAliasesTable.createdBy,
      createdAt: symbolAliasesTable.createdAt,
      symbolId: symbolsTable.id,
      canonicalSymbol: symbolsTable.canonicalSymbol,
    })
      .from(symbolAliasesTable)
      .innerJoin(symbolsTable, eq(symbolAliasesTable.symbolId, symbolsTable.id))
      .orderBy(desc(symbolAliasesTable.createdAt));
    return res.json(aliases);
  } catch (err) {
    req.log.error(err, "Failed to list symbol aliases");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Add an alias mapping (e.g. "WallStreet30" -> "US30"), optionally
// attributed to the broker that reports this raw symbol string.
router.post("/admin/aliases", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const { alias, canonicalSymbol, brokerId } = req.body as { alias?: string; canonicalSymbol?: string; brokerId?: number };
  if (!alias || !canonicalSymbol) {
    return res.status(400).json({ error: "'alias' and 'canonicalSymbol' are required" });
  }

  try {
    const [symbol] = await db.select().from(symbolsTable).where(eq(symbolsTable.canonicalSymbol, canonicalSymbol.toUpperCase()));
    if (!symbol) return res.status(404).json({ error: "Canonical symbol not found" });

    const [created] = await db.insert(symbolAliasesTable).values({
      alias: alias.toLowerCase(),
      symbolId: symbol.id,
      source: brokerId ? "broker" : "admin",
      brokerId: brokerId ?? null,
      createdBy: userId,
    }).returning();
    invalidateSymbolCache();
    return res.status(201).json(created);
  } catch (err) {
    req.log.error(err, "Failed to create symbol alias");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Enable or disable an alias without deleting it, and allow remapping to a
// different canonical symbol or renaming the alias string.
router.patch("/admin/aliases/:id", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const id = Number(req.params.id);
  const { enabled, canonicalSymbol, alias } = req.body as { enabled?: boolean; canonicalSymbol?: string; alias?: string };

  if (enabled === undefined && canonicalSymbol === undefined && alias === undefined) {
    return res.status(400).json({ error: "At least one of 'enabled', 'canonicalSymbol', or 'alias' is required" });
  }

  try {
    const updates: Record<string, unknown> = {};
    if (enabled !== undefined) updates.enabled = enabled;
    if (alias !== undefined) updates.alias = alias.toLowerCase();

    if (canonicalSymbol !== undefined) {
      const [symbol] = await db.select().from(symbolsTable).where(eq(symbolsTable.canonicalSymbol, canonicalSymbol.toUpperCase()));
      if (!symbol) return res.status(404).json({ error: "Canonical symbol not found" });
      updates.symbolId = symbol.id;
    }

    const [updated] = await db.update(symbolAliasesTable).set(updates).where(eq(symbolAliasesTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    invalidateSymbolCache();
    if (userId && enabled !== undefined) {
      await logAudit(userId, "symbol_mapping.conflict_resolved", "symbol_alias", String(id), { enabled });
    }
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to update symbol alias");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/aliases/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [deleted] = await db.delete(symbolAliasesTable).where(eq(symbolAliasesTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    invalidateSymbolCache();
    return res.json(deleted);
  } catch (err) {
    req.log.error(err, "Failed to delete symbol alias");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin: symbol mapping cache visibility ─────────────────────────────────

router.get("/admin/mapping-cache", requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: symbolMappingCacheTable.id,
        rawAlias: symbolMappingCacheTable.rawAlias,
        brokerId: symbolMappingCacheTable.brokerId,
        mappingSource: symbolMappingCacheTable.mappingSource,
        refreshedAt: symbolMappingCacheTable.refreshedAt,
        canonicalSymbolId: symbolsTable.id,
        canonicalSymbol: symbolsTable.canonicalSymbol,
      })
      .from(symbolMappingCacheTable)
      .leftJoin(symbolsTable, eq(symbolMappingCacheTable.canonicalSymbolId, symbolsTable.id))
      .orderBy(desc(symbolMappingCacheTable.refreshedAt))
      .limit(500);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list symbol mapping cache");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin: mapping conflicts ────────────────────────────────────────────────

router.get("/admin/mapping-conflicts", requireAdmin, async (req, res) => {
  try {
    const { unresolvedOnly } = req.query;
    const conditions = unresolvedOnly === "true" ? [eq(symbolMappingConflictsTable.resolved, false)] : [];
    const previousSymbols = alias(symbolsTable, "previous_symbols");
    const newSymbols = alias(symbolsTable, "new_symbols");
    const rows = await db
      .select({
        id: symbolMappingConflictsTable.id,
        rawAlias: symbolMappingConflictsTable.rawAlias,
        brokerId: symbolMappingConflictsTable.brokerId,
        previousSymbolId: symbolMappingConflictsTable.previousSymbolId,
        newSymbolId: symbolMappingConflictsTable.newSymbolId,
        previousSymbol: previousSymbols.canonicalSymbol,
        newSymbol: newSymbols.canonicalSymbol,
        source: symbolMappingConflictsTable.source,
        resolved: symbolMappingConflictsTable.resolved,
        createdAt: symbolMappingConflictsTable.createdAt,
      })
      .from(symbolMappingConflictsTable)
      .leftJoin(previousSymbols, eq(symbolMappingConflictsTable.previousSymbolId, previousSymbols.id))
      .leftJoin(newSymbols, eq(symbolMappingConflictsTable.newSymbolId, newSymbols.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(symbolMappingConflictsTable.createdAt))
      .limit(500);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list symbol mapping conflicts");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/mapping-conflicts/:id/resolve", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const id = Number(req.params.id);
  try {
    const [updated] = await db
      .update(symbolMappingConflictsTable)
      .set({ resolved: true })
      .where(eq(symbolMappingConflictsTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    if (userId) await logAudit(userId, "symbol_mapping.conflict_resolved", "symbol_mapping_conflict", String(id));
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to resolve symbol mapping conflict");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin: regex fallback rules ─────────────────────────────────────────────
// Last-resort resolution tier, tried only after exact/alias/suffix-strip and
// the trainer round-trip have failed for a raw broker symbol.

router.get("/admin/regex-patterns", requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: symbolRegexPatternsTable.id,
        pattern: symbolRegexPatternsTable.pattern,
        priority: symbolRegexPatternsTable.priority,
        isActive: symbolRegexPatternsTable.isActive,
        createdAt: symbolRegexPatternsTable.createdAt,
        symbolId: symbolsTable.id,
        canonicalSymbol: symbolsTable.canonicalSymbol,
      })
      .from(symbolRegexPatternsTable)
      .innerJoin(symbolsTable, eq(symbolRegexPatternsTable.symbolId, symbolsTable.id))
      .orderBy(symbolRegexPatternsTable.priority);
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list symbol regex patterns");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/regex-patterns", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const { pattern, canonicalSymbol, priority } = req.body as { pattern?: string; canonicalSymbol?: string; priority?: number };
  if (!pattern || !canonicalSymbol) {
    return res.status(400).json({ error: "'pattern' and 'canonicalSymbol' are required" });
  }
  try {
    new RegExp(pattern); // validate before persisting
  } catch {
    return res.status(400).json({ error: "Invalid regular expression" });
  }

  try {
    const [symbol] = await db.select().from(symbolsTable).where(eq(symbolsTable.canonicalSymbol, canonicalSymbol.toUpperCase()));
    if (!symbol) return res.status(404).json({ error: "Canonical symbol not found" });

    const [created] = await db.insert(symbolRegexPatternsTable).values({
      pattern,
      symbolId: symbol.id,
      priority: priority ?? 0,
      createdBy: userId ?? null,
    }).returning();
    invalidateRegexPatternCache();
    if (userId) await logAudit(userId, "symbol_regex_pattern.created", "symbol_regex_pattern", String(created.id), { pattern, canonicalSymbol });
    return res.status(201).json(created);
  } catch (err) {
    req.log.error(err, "Failed to create symbol regex pattern");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/regex-patterns/:id", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const id = Number(req.params.id);
  const { pattern, priority, isActive } = req.body as { pattern?: string; priority?: number; isActive?: boolean };

  if (pattern !== undefined) {
    try {
      new RegExp(pattern);
    } catch {
      return res.status(400).json({ error: "Invalid regular expression" });
    }
  }

  try {
    const [updated] = await db.update(symbolRegexPatternsTable)
      .set({ ...(pattern !== undefined && { pattern }), ...(priority !== undefined && { priority }), ...(isActive !== undefined && { isActive }) })
      .where(eq(symbolRegexPatternsTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    invalidateRegexPatternCache();
    if (userId) await logAudit(userId, "symbol_regex_pattern.updated", "symbol_regex_pattern", String(id));
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to update symbol regex pattern");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/regex-patterns/:id", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const id = Number(req.params.id);
  try {
    const [deleted] = await db.delete(symbolRegexPatternsTable).where(eq(symbolRegexPatternsTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    invalidateRegexPatternCache();
    if (userId) await logAudit(userId, "symbol_regex_pattern.deleted", "symbol_regex_pattern", String(id));
    return res.json(deleted);
  } catch (err) {
    req.log.error(err, "Failed to delete symbol regex pattern");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
