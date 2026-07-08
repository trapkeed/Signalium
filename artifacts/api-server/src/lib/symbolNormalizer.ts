import { db, symbolsTable, symbolAliasesTable, symbolCategoriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface CacheEntry {
  symbolId: number;
  canonicalSymbol: string;
}

let cache: Map<string, CacheEntry> | null = null;
let loadingPromise: Promise<Map<string, CacheEntry>> | null = null;

/** Broker/EA noise suffixes stripped iteratively when a raw symbol doesn't match directly. */
const NOISE_SUFFIXES = [
  ".a", ".b", ".c", ".i", ".x", ".m", ".pro", ".raw", ".ecn", ".micro", ".mini",
  ".cent", ".std", ".classic", ".prime", ".zero", "-", "_",
  "pro", "raw", "ecn", "micro", "mini", "cent", "classic", "prime", "zero", "m",
];

async function loadCache(): Promise<Map<string, CacheEntry>> {
  const symbols = await db.select().from(symbolsTable);
  const aliases = await db.select().from(symbolAliasesTable);

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
}

async function getCache(): Promise<Map<string, CacheEntry>> {
  if (cache) return cache;
  if (!loadingPromise) {
    loadingPromise = loadCache().then((m) => {
      cache = m;
      return m;
    });
  }
  return loadingPromise;
}

export interface NormalizationResult {
  resolved: boolean;
  canonicalSymbol?: string;
  symbolId?: number;
}

/**
 * Normalizes a raw EA/broker/platform symbol string to its canonical form.
 * Strategy: exact case-insensitive lookup against canonical symbols + aliases,
 * then iterative stripping of known broker noise suffixes, re-checking the
 * lookup table after each strip. Unknown symbols are rejected (resolved: false).
 */
export async function normalizeSymbol(rawInput: string): Promise<NormalizationResult> {
  const table = await getCache();
  const trimmed = rawInput.trim();
  if (!trimmed) return { resolved: false };

  let candidate = trimmed.toLowerCase();
  const direct = table.get(candidate);
  if (direct) return { resolved: true, canonicalSymbol: direct.canonicalSymbol, symbolId: direct.symbolId };

  for (let attempt = 0; attempt < 4; attempt++) {
    let stripped = false;
    for (const suffix of NOISE_SUFFIXES) {
      if (candidate.length > suffix.length && candidate.endsWith(suffix)) {
        const next = candidate.slice(0, candidate.length - suffix.length);
        if (next.length === 0) continue;
        candidate = next;
        stripped = true;
        const hit = table.get(candidate);
        if (hit) return { resolved: true, canonicalSymbol: hit.canonicalSymbol, symbolId: hit.symbolId };
        break;
      }
    }
    if (!stripped) break;
  }

  return { resolved: false };
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
  { alias: "GOLD", canonicalSymbol: "XAUUSD" },
  { alias: "SILVER", canonicalSymbol: "XAGUSD" },
  { alias: "WALLSTREET30", canonicalSymbol: "US30" },
  { alias: "US30CASH", canonicalSymbol: "US30" },
  { alias: "NASDAQ100", canonicalSymbol: "NAS100" },
  { alias: "USTECH100", canonicalSymbol: "NAS100" },
  { alias: "SP500", canonicalSymbol: "SPX500" },
  { alias: "US500", canonicalSymbol: "SPX500" },
  { alias: "DE40", canonicalSymbol: "GER40" },
  { alias: "DAX40", canonicalSymbol: "GER40" },
  { alias: "FTSE100", canonicalSymbol: "UK100" },
  { alias: "NIKKEI225", canonicalSymbol: "JPN225" },
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
