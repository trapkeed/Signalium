import {
  db,
  symbolsTable,
  symbolAliasesTable,
  symbolCategoriesTable,
  symbolRegexPatternsTable,
  symbolMappingCacheTable,
  symbolMappingConflictsTable,
} from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
export type { SymbolAlias } from "@workspace/db";

interface CacheEntry {
  symbolId: number;
  canonicalSymbol: string;
}

let cache: Map<string, CacheEntry> | null = null;
let loadingPromise: Promise<Map<string, CacheEntry>> | null = null;
let cacheLoadedAt = 0;

// The in-memory lookup table is normally invalidated explicitly on any
// admin write (see invalidateSymbolCache), but it's also force-refreshed if
// it's simply gotten old — matches the 24h refresh cadence used for the
// EA-side broker symbol mapping cache so both layers stay in sync with the
// same freshness contract.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Broker/EA noise suffixes stripped iteratively when a raw symbol doesn't match directly. */
const NOISE_SUFFIXES = [
  // dot-prefixed broker decorators (must be checked before bare suffixes)
  ".a", ".b", ".c", ".i", ".x", ".m", ".pro", ".raw", ".ecn", ".micro", ".mini",
  ".cent", ".std", ".classic", ".prime", ".zero", ".cash",
  // underscore variants common in MT5 (e.g. EURUSD_i, XAUUSD_a)
  "_i", "_a", "_b", "_c", "_x",
  // separators stripped as a last resort
  "-", "_",
  // bare suffixes
  "pro", "raw", "ecn", "micro", "mini", "cent", "classic", "prime", "zero", "m",
  // trailing dot (some brokers append a period: EURUSD.)
  ".",
];

async function loadCache(): Promise<Map<string, CacheEntry>> {
  const symbols = await db.select().from(symbolsTable);
  // Only enabled aliases participate in normalization lookups.
  const aliases = await db.select().from(symbolAliasesTable).where(eq(symbolAliasesTable.enabled, true));

  const map = new Map<string, CacheEntry>();
  for (const s of symbols) {
    map.set(s.canonicalSymbol.toLowerCase(), { symbolId: s.id, canonicalSymbol: s.canonicalSymbol });
  }
  const byId = new Map(symbols.map((s) => [s.id, s]));
  for (const a of aliases) {
    const symbol = byId.get(a.symbolId);
    if (!symbol) continue;
    map.set(a.alias.toLowerCase(), { symbolId: symbol.id, canonicalSymbol: symbol.canonicalSymbol });
  }
  return map;
}

/** Invalidates the in-memory lookup cache. Call after any admin write to symbols/aliases. */
export function invalidateSymbolCache(): void {
  cache = null;
  loadingPromise = null;
  cacheLoadedAt = 0;
}

async function getCache(): Promise<Map<string, CacheEntry>> {
  const isStale = cache !== null && Date.now() - cacheLoadedAt > CACHE_TTL_MS;
  if (cache && !isStale) return cache;
  if (isStale) {
    cache = null;
    loadingPromise = null;
  }
  if (!loadingPromise) {
    loadingPromise = loadCache().then((m) => {
      cache = m;
      cacheLoadedAt = Date.now();
      return m;
    });
  }
  return loadingPromise;
}

export interface NormalizationResult {
  resolved: boolean;
  canonicalSymbol?: string;
  symbolId?: number;
  /** Which tier resolved this — used for conflict logging/attribution. */
  source?: "exact" | "suffix_strip" | "regex_fallback";
}

let regexPatternCache: { symbolId: number; canonicalSymbol: string; regex: RegExp; priority: number }[] | null = null;

async function loadRegexPatterns() {
  if (regexPatternCache) return regexPatternCache;
  const rows = await db
    .select({
      pattern: symbolRegexPatternsTable.pattern,
      priority: symbolRegexPatternsTable.priority,
      symbolId: symbolsTable.id,
      canonicalSymbol: symbolsTable.canonicalSymbol,
    })
    .from(symbolRegexPatternsTable)
    .innerJoin(symbolsTable, eq(symbolRegexPatternsTable.symbolId, symbolsTable.id))
    .where(eq(symbolRegexPatternsTable.isActive, true))
    .orderBy(symbolRegexPatternsTable.priority);

  regexPatternCache = rows.flatMap((r) => {
    try {
      return [{ symbolId: r.symbolId, canonicalSymbol: r.canonicalSymbol, regex: new RegExp(r.pattern, "i"), priority: r.priority }];
    } catch {
      return []; // malformed admin-entered regex — skip rather than crash normalization
    }
  });
  return regexPatternCache;
}

/** Invalidates the admin-approved regex fallback cache. Call after any write to symbol_regex_patterns. */
export function invalidateRegexPatternCache(): void {
  regexPatternCache = null;
}

/**
 * Last-resort fallback tried only after exact/alias lookup, suffix-stripping,
 * AND the trainer round-trip (see resolveDiscoveredAlias below) have all
 * failed to resolve a raw broker symbol. Admin-approved regex rules exist
 * for brokers with truly unpredictable naming schemes the trainer hasn't
 * seen either (e.g. internal white-label brokers).
 */
async function tryRegexFallback(rawInput: string): Promise<NormalizationResult> {
  const patterns = await loadRegexPatterns();
  for (const p of patterns) {
    if (p.regex.test(rawInput)) {
      return { resolved: true, canonicalSymbol: p.canonicalSymbol, symbolId: p.symbolId, source: "regex_fallback" };
    }
  }
  return { resolved: false };
}

/**
 * Normalizes a raw EA/broker/platform symbol string to its canonical form.
 * Strategy: exact case-insensitive lookup against canonical symbols + aliases,
 * then iterative stripping of known broker noise suffixes, re-checking the
 * lookup table after each strip, then (if still unresolved) admin-approved
 * regex fallback rules. Unknown symbols are rejected (resolved: false).
 */
export async function normalizeSymbol(rawInput: string): Promise<NormalizationResult> {
  const table = await getCache();
  const trimmed = rawInput.trim();
  if (!trimmed) return { resolved: false };

  let candidate = trimmed.toLowerCase();
  const direct = table.get(candidate);
  if (direct) return { resolved: true, canonicalSymbol: direct.canonicalSymbol, symbolId: direct.symbolId, source: "exact" };

  for (let attempt = 0; attempt < 4; attempt++) {
    let stripped = false;
    for (const suffix of NOISE_SUFFIXES) {
      if (candidate.length > suffix.length && candidate.endsWith(suffix)) {
        const next = candidate.slice(0, candidate.length - suffix.length);
        if (next.length === 0) continue;
        candidate = next;
        stripped = true;
        const hit = table.get(candidate);
        if (hit) return { resolved: true, canonicalSymbol: hit.canonicalSymbol, symbolId: hit.symbolId, source: "suffix_strip" };
        break;
      }
    }
    if (!stripped) break;
  }

  return tryRegexFallback(trimmed);
}

/**
 * Records a discovered broker alias's resolved mapping into the mapping
 * cache table, logging a conflict if the newly-resolved canonical symbol
 * disagrees with what was previously cached for the same raw alias (e.g.
 * the trainer now maps EURUSDm differently than a stale regex/admin entry
 * did). Idempotent no-op if the mapping hasn't changed.
 */
export async function cacheAliasMapping(params: {
  rawAlias: string;
  brokerId: number | null;
  canonicalSymbolId: number | null;
  mappingSource: "trainer" | "regex_fallback" | "admin" | "local_normalizer";
}): Promise<{ conflict: boolean }> {
  const { rawAlias, brokerId, canonicalSymbolId, mappingSource } = params;

  const [existing] = await db
    .select()
    .from(symbolMappingCacheTable)
    .where(and(eq(symbolMappingCacheTable.rawAlias, rawAlias), brokerId !== null ? eq(symbolMappingCacheTable.brokerId, brokerId) : isNull(symbolMappingCacheTable.brokerId)))
    .orderBy(desc(symbolMappingCacheTable.refreshedAt))
    .limit(1);

  let conflict = false;
  if (
    existing &&
    existing.canonicalSymbolId !== null &&
    canonicalSymbolId !== null &&
    existing.canonicalSymbolId !== canonicalSymbolId
  ) {
    conflict = true;
    await db.insert(symbolMappingConflictsTable).values({
      rawAlias,
      brokerId,
      previousSymbolId: existing.canonicalSymbolId,
      newSymbolId: canonicalSymbolId,
      source: mappingSource,
    });
  }

  if (existing) {
    await db
      .update(symbolMappingCacheTable)
      .set({ canonicalSymbolId, mappingSource, refreshedAt: new Date() })
      .where(eq(symbolMappingCacheTable.id, existing.id));
  } else {
    await db.insert(symbolMappingCacheTable).values({ rawAlias, brokerId, canonicalSymbolId, mappingSource });
  }

  return { conflict };
}

export async function listSymbolsWithCategories() {
  return db
    .select({
      id: symbolsTable.id,
      canonicalSymbol: symbolsTable.canonicalSymbol,
      displayName: symbolsTable.displayName,
      enabled: symbolsTable.enabled,
      categoryId: symbolsTable.categoryId,
      categoryName: symbolCategoriesTable.name,
      categorySlug: symbolCategoriesTable.slug,
    })
    .from(symbolsTable)
    .innerJoin(symbolCategoriesTable, eq(symbolsTable.categoryId, symbolCategoriesTable.id));
}

const SEED_CATEGORIES: { name: string; slug: string }[] = [
  { name: "Metals", slug: "metals" },
  { name: "Forex", slug: "forex" },
  { name: "Indices", slug: "indices" },
];

const SEED_SYMBOLS: { canonicalSymbol: string; displayName: string; categorySlug: string }[] = [
  { canonicalSymbol: "XAUUSD", displayName: "Gold vs US Dollar", categorySlug: "metals" },
  { canonicalSymbol: "XAGUSD", displayName: "Silver vs US Dollar", categorySlug: "metals" },
  { canonicalSymbol: "EURUSD", displayName: "Euro vs US Dollar", categorySlug: "forex" },
  { canonicalSymbol: "GBPUSD", displayName: "British Pound vs US Dollar", categorySlug: "forex" },
  { canonicalSymbol: "USDJPY", displayName: "US Dollar vs Japanese Yen", categorySlug: "forex" },
  { canonicalSymbol: "AUDUSD", displayName: "Australian Dollar vs US Dollar", categorySlug: "forex" },
  { canonicalSymbol: "USDCAD", displayName: "US Dollar vs Canadian Dollar", categorySlug: "forex" },
  { canonicalSymbol: "USDCHF", displayName: "US Dollar vs Swiss Franc", categorySlug: "forex" },
  { canonicalSymbol: "US30", displayName: "Dow Jones Industrial Average", categorySlug: "indices" },
  { canonicalSymbol: "NAS100", displayName: "Nasdaq 100", categorySlug: "indices" },
  { canonicalSymbol: "SPX500", displayName: "S&P 500", categorySlug: "indices" },
  { canonicalSymbol: "GER40", displayName: "DAX 40", categorySlug: "indices" },
  { canonicalSymbol: "UK100", displayName: "FTSE 100", categorySlug: "indices" },
  { canonicalSymbol: "JPN225", displayName: "Nikkei 225", categorySlug: "indices" },
];

const SEED_ALIASES: { alias: string; canonicalSymbol: string }[] = [
  // Metals
  { alias: "GOLD", canonicalSymbol: "XAUUSD" },
  { alias: "SILVER", canonicalSymbol: "XAGUSD" },
  // EURUSD broker variants that suffix-strip can't reach
  { alias: "fx_EURUSD", canonicalSymbol: "EURUSD" },
  // US30 broker aliases — suffix-strip can't deduce these from the base string
  { alias: "DJ30",       canonicalSymbol: "US30" },
  { alias: "WS30",       canonicalSymbol: "US30" },
  { alias: "WALLSTREET30", canonicalSymbol: "US30" },
  { alias: "US30CASH",   canonicalSymbol: "US30" },
  // NAS100
  { alias: "NASDAQ100",  canonicalSymbol: "NAS100" },
  { alias: "USTECH100",  canonicalSymbol: "NAS100" },
  // SPX500
  { alias: "SP500",      canonicalSymbol: "SPX500" },
  { alias: "US500",      canonicalSymbol: "SPX500" },
  // GER40
  { alias: "DE40",       canonicalSymbol: "GER40" },
  { alias: "DAX40",      canonicalSymbol: "GER40" },
  // Other indices
  { alias: "FTSE100",    canonicalSymbol: "UK100" },
  { alias: "NIKKEI225",  canonicalSymbol: "JPN225" },
];

/** Idempotently seeds the canonical symbol registry with well-known instruments and aliases. */
export async function seedSymbolRegistry(): Promise<void> {
  const categoryIdBySlug = new Map<string, number>();
  for (const cat of SEED_CATEGORIES) {
    const [existing] = await db.select().from(symbolCategoriesTable).where(eq(symbolCategoriesTable.slug, cat.slug));
    if (existing) {
      categoryIdBySlug.set(cat.slug, existing.id);
    } else {
      const [created] = await db.insert(symbolCategoriesTable).values(cat).returning();
      categoryIdBySlug.set(cat.slug, created.id);
    }
  }

  const symbolIdByCanonical = new Map<string, number>();
  for (const sym of SEED_SYMBOLS) {
    const [existing] = await db.select().from(symbolsTable).where(eq(symbolsTable.canonicalSymbol, sym.canonicalSymbol));
    if (existing) {
      symbolIdByCanonical.set(sym.canonicalSymbol, existing.id);
    } else {
      const categoryId = categoryIdBySlug.get(sym.categorySlug)!;
      const [created] = await db.insert(symbolsTable).values({
        canonicalSymbol: sym.canonicalSymbol,
        displayName: sym.displayName,
        categoryId,
      }).returning();
      symbolIdByCanonical.set(sym.canonicalSymbol, created.id);
    }
  }

  for (const a of SEED_ALIASES) {
    const [existing] = await db.select().from(symbolAliasesTable).where(eq(symbolAliasesTable.alias, a.alias.toLowerCase()));
    if (existing) continue;
    const symbolId = symbolIdByCanonical.get(a.canonicalSymbol);
    if (!symbolId) continue;
    await db.insert(symbolAliasesTable).values({ alias: a.alias.toLowerCase(), symbolId, source: "admin" });
  }

  invalidateSymbolCache();
}
