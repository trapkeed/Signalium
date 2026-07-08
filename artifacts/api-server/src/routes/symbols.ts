import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  symbolsTable,
  symbolCategoriesTable,
  symbolAliasesTable,
  symbolNormalizationLogTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { normalizeSymbol, invalidateSymbolCache, listSymbolsWithCategories } from "../lib/symbolNormalizer";

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

// Add an alias mapping (e.g. "WallStreet30" -> "US30").
router.post("/admin/aliases", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const { alias, canonicalSymbol } = req.body as { alias?: string; canonicalSymbol?: string };
  if (!alias || !canonicalSymbol) {
    return res.status(400).json({ error: "'alias' and 'canonicalSymbol' are required" });
  }

  try {
    const [symbol] = await db.select().from(symbolsTable).where(eq(symbolsTable.canonicalSymbol, canonicalSymbol.toUpperCase()));
    if (!symbol) return res.status(404).json({ error: "Canonical symbol not found" });

    const [created] = await db.insert(symbolAliasesTable).values({
      alias: alias.toLowerCase(),
      symbolId: symbol.id,
      source: "admin",
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
