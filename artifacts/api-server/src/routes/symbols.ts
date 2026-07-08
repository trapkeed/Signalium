import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  symbolsTable,
  symbolCategoriesTable,
  symbolAliasesTable,
  symbolNormalizationLogTable,
  userSymbolsTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { normalizeSymbol, invalidateSymbolCache, listSymbolsWithCategories } from "../lib/symbolNormalizer";
import { checkUserSymbolLimit } from "../lib/entitlementEngine";

const router = Router();

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

export default router;
