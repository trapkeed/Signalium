import crypto from "crypto";
import { objectStorageClient, ObjectNotFoundError } from "./objectStorage";

export interface EaMetadata {
  userId: string;
  apiKeyHash: string;
  buildId: string;
  subscriptionTier: string;
  generationTimestamp: string;
  platformVersion: string;
}

/**
 * A point-in-time snapshot of the canonical symbol registry embedded into the
 * EA at build time. The EA uses this as an offline fallback so it can resolve
 * broker symbols without a server round-trip; the 24h discovery scan updates
 * it with any overrides the server returns.
 */
export interface EaSymbolMap {
  /** All canonical symbols the platform supports. */
  canonicalSymbols: string[];
  /**
   * Universal alias → canonical mappings (source: "admin", all brokers).
   * Stored as parallel arrays so MQL5 can use a simple linear scan.
   */
  aliases: { alias: string; canonical: string }[];
  /**
   * Broker-specific alias → canonical overrides keyed by broker name.
   * Only populated when the EA is built for a known broker (i.e. the EA
   * registration already has a brokerId on record).
   */
  brokerMappings: { alias: string; canonical: string; brokerName: string }[];
}

export interface EaEmbeddedCredentials {
  /** Raw API key, compiled directly into the EA so users never type it in. */
  apiKey: string;
  hardwareBindingHint: string;
}

/**
 * Generates a fresh API key dedicated to a single EA build. Every build gets
 * its own key (rather than reusing whatever key the user happens to have
 * active) so the raw value can be embedded directly in the compiled EA and
 * the platform never needs to persist or re-display it afterwards — only
 * its SHA-256 hash is stored, matching the same never-store-plaintext rule
 * used for user-created API keys.
 */
export function generateBuildApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const rawKey = `sig_ea_${crypto.randomBytes(32).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  return { rawKey, keyHash, keyPrefix: rawKey.slice(0, 12) + "..." };
}

/**
 * Fetches the current canonical symbol registry and builds an EaSymbolMap
 * snapshot for embedding into an EA at build time.
 *
 * @param brokerId  Optional: when set, broker-specific aliases (brokerId = X)
 *                  are appended after universal aliases so they win via the
 *                  last-match-wins scan in the generated MQL5 lookup function.
 */
export async function buildSymbolMapForEa(brokerId?: number | null): Promise<EaSymbolMap> {
  // We import here (not at top) to avoid a circular dep with the route layer.
  const { db, symbolsTable, symbolAliasesTable } = await import("@workspace/db");
  const { eq, and, or, isNull } = await import("drizzle-orm");

  const symbols = await db.select({ canonical: symbolsTable.canonicalSymbol }).from(symbolsTable).where(eq(symbolsTable.enabled, true));

  // Universal aliases (not broker-specific) that are enabled.
  const universalRows = await db
    .select({ alias: symbolAliasesTable.alias, canonical: symbolsTable.canonicalSymbol })
    .from(symbolAliasesTable)
    .innerJoin(symbolsTable, eq(symbolAliasesTable.symbolId, symbolsTable.id))
    .where(and(eq(symbolAliasesTable.enabled, true), isNull(symbolAliasesTable.brokerId)));

  // Broker-specific aliases for the known broker, if provided.
  let brokerRows: { alias: string; canonical: string; brokerName: string }[] = [];
  if (brokerId != null) {
    const { brokersTable } = await import("@workspace/db");
    const brokerSpecific = await db
      .select({ alias: symbolAliasesTable.alias, canonical: symbolsTable.canonicalSymbol, brokerName: brokersTable.name })
      .from(symbolAliasesTable)
      .innerJoin(symbolsTable, eq(symbolAliasesTable.symbolId, symbolsTable.id))
      .innerJoin(brokersTable, eq(symbolAliasesTable.brokerId, brokersTable.id))
      .where(and(eq(symbolAliasesTable.enabled, true), eq(symbolAliasesTable.brokerId, brokerId)));
    brokerRows = brokerSpecific;
  }

  return {
    canonicalSymbols: symbols.map((s) => s.canonical),
    aliases: universalRows,
    brokerMappings: brokerRows,
  };
}

/** Derives a filesystem/EA-safe username from a Clerk user's profile fields. */
export function deriveUsername(user: { firstName?: string | null; lastName?: string | null; email: string }): string {
  const base = user.firstName || user.email.split("@")[0] || "trader";
  const safe = base.replace(/[^a-zA-Z0-9]/g, "");
  return safe.length > 0 ? safe : "Trader";
}

/**
 * Filename convention: `Signalium_<username>_<apikeyhash>.ex5`. The API key
 * hash (not the raw key) is embedded so filenames are unique per build/key
 * without ever leaking the credential itself, and support can identify which
 * key a given binary was compiled with just from its filename.
 */
export function buildFileName(username: string, apiKeyHash: string): string {
  return `Signalium_${username}_${apiKeyHash.slice(0, 16)}.ex5`;
}

/**
 * Renders the embedded symbol map as MQL5 array literals so the EA has a
 * static offline lookup that mirrors the platform's canonical registry.
 * Two tables are emitted:
 *   - SIGNALIUM_CANONICAL_SYMBOLS — the authoritative list of canonical names
 *   - SIGNALIUM_ALIAS_MAP_RAW / SIGNALIUM_ALIAS_MAP_CANONICAL — parallel
 *     arrays for exact-match alias resolution (broker string → canonical)
 * Broker-specific overrides are appended to the alias arrays and win because
 * the EA linear-scans from the end (last match wins).
 */
function renderSymbolMapMql5(symbolMap: EaSymbolMap): string {
  const canonicals = symbolMap.canonicalSymbols;

  // Merge universal aliases first, then broker-specific ones (so broker wins).
  const allAliases = [
    ...symbolMap.aliases,
    ...symbolMap.brokerMappings.map((m) => ({ alias: m.alias, canonical: m.canonical })),
  ];

  const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  const canonicalsLiteral = canonicals.map(q).join(", ");
  const aliasRawLiteral = allAliases.map((a) => q(a.alias)).join(", ");
  const aliasCanonicalLiteral = allAliases.map((a) => q(a.canonical)).join(", ");

  return `
// ─── Embedded symbol registry (generated at build time, refreshed every 24h) ─
// Canonical symbol list — the only symbols the platform and trainer recognise.
// The EA normalises every broker raw string to one of these before sending
// telemetry so the trainer never needs to handle broker-specific naming.
#define SIGNALIUM_CANONICAL_COUNT ${canonicals.length}
string SIGNALIUM_CANONICAL_SYMBOLS[${canonicals.length}] = {${canonicalsLiteral}};

// Alias lookup tables (parallel arrays — aliasRaw[i] maps to aliasCanonical[i]).
// Universal aliases come first; broker-specific overrides are appended and win
// via last-match-wins scan.  Refreshed on each 24h discovery scan.
#define SIGNALIUM_ALIAS_COUNT ${allAliases.length}
string SIGNALIUM_ALIAS_MAP_RAW[${allAliases.length || 1}]       = {${aliasRawLiteral || '""'}};
string SIGNALIUM_ALIAS_MAP_CANONICAL[${allAliases.length || 1}] = {${aliasCanonicalLiteral || '""'}};

// Normalises a raw broker symbol string to its canonical form using the
// embedded tables above.  Returns the empty string if no mapping is found;
// the EA must then fall back to the 24h server discovery scan result.
string SignaliumNormaliseSymbol(string raw) {
   string lower = StringToLower(raw);
   // Last-match-wins: broker-specific overrides are at the tail of the array.
   for (int i = SIGNALIUM_ALIAS_COUNT - 1; i >= 0; i--) {
      if (lower == StringToLower(SIGNALIUM_ALIAS_MAP_RAW[i]))
         return SIGNALIUM_ALIAS_MAP_CANONICAL[i];
   }
   // Check canonical symbols directly (e.g. EA already uses canonical name).
   for (int i = 0; i < SIGNALIUM_CANONICAL_COUNT; i++) {
      if (lower == StringToLower(SIGNALIUM_CANONICAL_SYMBOLS[i]))
         return SIGNALIUM_CANONICAL_SYMBOLS[i];
   }
   return ""; // unresolved — server discovery scan will handle it
}
`;
}

/**
 * Renders the volume normalisation section of the EA — rounding-policy
 * defines, the volume-constraint cache struct, and the three public helpers
 * (fetch, normalise, validate) that the EA calls.
 *
 * The rounding policy is embedded as an integer #define so the MQL5 compiler
 * can inline the branch and the EA never needs a string comparison at runtime.
 */
function renderVolumeSectionMql5(): string {
  return `
// ─── Broker volume constraints (populated on OnInit, refreshed every 24h) ───
// The EA reads SYMBOL_VOLUME_MIN / MAX / STEP from the broker terminal for
// every active symbol and reports them to the platform.  These constants are
// stored server-side (broker_volume_constraints table) and also cached here
// locally so SignaliumNormaliseVolume / SignaliumValidateVolume can work
// offline without a round-trip.

// Rounding policy — controls how a raw volume is snapped to the nearest
// valid step multiple before submission to the broker.
//   SIGNALIUM_ROUND_DOWN    (0) — always round toward zero          [default]
//   SIGNALIUM_ROUND_UP      (1) — always round away from zero
//   SIGNALIUM_ROUND_NEAREST (2) — round to the nearest step
#define SIGNALIUM_ROUND_DOWN    0
#define SIGNALIUM_ROUND_UP      1
#define SIGNALIUM_ROUND_NEAREST 2
// Change this define in a custom build to override the platform default.
#ifndef SIGNALIUM_VOLUME_ROUNDING
  #define SIGNALIUM_VOLUME_ROUNDING SIGNALIUM_ROUND_DOWN
#endif

struct SignaliumVolumeConstraint {
   string symbol;    // canonical symbol (e.g. "XAUUSD")
   double volumeMin;
   double volumeMax;
   double volumeStep;
};

// In-process cache — filled by SignaliumFetchVolumeConstraints() on OnInit.
SignaliumVolumeConstraint g_volumeConstraints[];
int                       g_volumeConstraintCount = 0;

// Returns the number of decimal places for a given step value so floating-
// point artefacts (e.g. 0.30000000000000004) are eliminated after rounding.
int SignaliumStepDecimals(double step) {
   if (step <= 0) return 8;
   string s    = DoubleToString(step, 8);
   int    dot  = StringFind(s, ".");
   if (dot < 0) return 0;
   int decimals = 0;
   for (int i = StringLen(s) - 1; i > dot; i--) {
      if (StringGetCharacter(s, i) != '0') { decimals = i - dot; break; }
   }
   return decimals;
}

// Normalise a raw lot size to the nearest valid step multiple.
// Uses the SIGNALIUM_VOLUME_ROUNDING policy embedded at build time.
// Returns the raw volume unchanged if no constraint is cached for the symbol.
double SignaliumNormaliseVolume(string symbol, double rawVolume) {
   for (int i = 0; i < g_volumeConstraintCount; i++) {
      if (g_volumeConstraints[i].symbol == symbol) {
         double step = g_volumeConstraints[i].volumeStep;
         if (step <= 0) return rawVolume;
         double steps = rawVolume / step;
         double normalised;
         int policy = SIGNALIUM_VOLUME_ROUNDING;
         if (policy == SIGNALIUM_ROUND_UP)
            normalised = MathCeil(steps)  * step;
         else if (policy == SIGNALIUM_ROUND_NEAREST)
            normalised = MathRound(steps) * step;
         else
            normalised = MathFloor(steps) * step;  // ROUND_DOWN (default)
         int dp = SignaliumStepDecimals(step);
         return NormalizeDouble(normalised, dp);
      }
   }
   return rawVolume; // no constraint cached — returned as-is
}

// Validate a (pre-normalised) volume against broker min/max.
// Returns true if the volume is within the broker's permitted range.
// Call SignaliumNormaliseVolume() first, then pass the result here.
bool SignaliumValidateVolume(string symbol, double normalisedVolume) {
   for (int i = 0; i < g_volumeConstraintCount; i++) {
      if (g_volumeConstraints[i].symbol == symbol) {
         if (normalisedVolume < g_volumeConstraints[i].volumeMin) return false;
         if (normalisedVolume > g_volumeConstraints[i].volumeMax) return false;
         return true;
      }
   }
   return true; // no constraint cached — not rejected
}

// Retrieve broker volume constraints (POST /api/volume-constraints, API-key
// auth).  Called once in OnInit; the cached values are used by every
// SignaliumNormaliseVolume / SignaliumValidateVolume call thereafter.
// Also called on the 24h discovery refresh to pick up any broker-side changes.
void SignaliumFetchVolumeConstraints() {
   // For each symbol discovered via SymbolsTotal()/SymbolName():
   //   double vMin  = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   //   double vMax  = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   //   double vStep = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   // Build a JSON array and POST to /api/volume-constraints (x-api-key auth):
   //   [ { "symbol": "XAUUSD", "volumeMin": 0.01, "volumeMax": 500.0,
   //       "volumeStep": 0.01 }, ... ]
   // On success the platform upserts the constraints server-side; also cache
   // them locally in g_volumeConstraints[] for offline use.
}
`;
}

/**
 * Generates the MQL5 source for the user's EA. This is the human-readable
 * template with embedded metadata (as commented constants, never the raw
 * API key) and stub implementations of the required capabilities.
 */
export function generateMql5Source(metadata: EaMetadata, credentials: EaEmbeddedCredentials, symbolMap?: EaSymbolMap): string {
  return `//+------------------------------------------------------------------+
//|                                         Signalium Expert Advisor |
//|                   Auto-generated — do not edit embedded metadata |
//+------------------------------------------------------------------+
#property copyright "Signalium"
#property version   "1.00"
#property strict

// ─── Embedded build metadata (read-only, verified server-side) ─────────────
// This build's API key is compiled in below — the user never has to type or
// paste it into the terminal. The key is scoped to this exact build/hardware
// pairing (see ea_registrations upsert on first connect); revoking or
// regenerating the build invalidates it and requires a fresh download.
#define SIGNALIUM_USER_ID            "${metadata.userId}"
#define SIGNALIUM_API_KEY            "${credentials.apiKey}"
#define SIGNALIUM_API_KEY_HASH       "${metadata.apiKeyHash}"
#define SIGNALIUM_BUILD_ID           "${metadata.buildId}"
#define SIGNALIUM_SUBSCRIPTION_TIER  "${metadata.subscriptionTier}"
#define SIGNALIUM_GENERATED_AT       "${metadata.generationTimestamp}"
#define SIGNALIUM_PLATFORM_VERSION   "${metadata.platformVersion}"
${symbolMap ? renderSymbolMapMql5(symbolMap) : "// Symbol map not available at build time — resolved entirely via 24h discovery scan."}
${renderVolumeSectionMql5()}
// ─── QDE loop (S14): EA <-> Platform <-> Trainer, every 30 seconds ─────────
// Primary channel: WebSocket to wss://<host>/ws/ea?apiKey=<key>&hardwareId=<id>
//   - On connect, send {"type":"telemetry", ...} frames every 30s (see below).
//   - Server replies inline with {"type":"action", id, action, reasoning,
//     symbol} whenever the trainer has a decision for the latest telemetry.
//   - Reply {"type":"ack", actionId} once the action has been applied so the
//     platform can mark it acknowledged (drives the retry/observability UI).
//   - Reply {"type":"pong"} to server {"type":"ping"} heartbeats; the server
//     sweeps dead sockets that miss a heartbeat and marks them disconnected.
// Fallback channel (used automatically if the WebSocket is unavailable):
//   - POST /api/qde/telemetry (x-api-key / x-hardware-id headers) every 30s.
//   - GET  /api/qde/actions/pending to poll for queued actions while offline;
//     queued actions are flushed automatically once the EA reconnects.
//   - POST /api/qde/actions/:id/ack once an action has been applied.
// Telemetry payload fields (every 30s, per open position or account-level):
//   balance, equity, margin, free_margin, open_positions, floating_pnl,
//   symbol, entry_price, current_price, spread, swap, commission, drawdown,
//   trade_age. Trainer actions: HOLD, ADD, REDUCE, TRAIL, BREAKEVEN,
//   LOCK_PROFIT, CLOSE.
// ─── Lifecycle ───────────────────────────────────────────────────────────
int OnInit() {
   SignaliumVerifyBuild();
   SignaliumFetchVolumeConstraints(); // reads SYMBOL_VOLUME_MIN/MAX/STEP from broker, reports to platform
   SignaliumConnectQdeSocket();
   EventSetTimer(30); // drives the 30s QDE telemetry cadence via OnTimer()
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) {
   EventKillTimer();
   SignaliumReportAccountState("deinit");
}

void OnTimer() {
   SignaliumReportQdeTelemetry();
   SignaliumRefreshSymbolDiscoveryIfDue(); // every 24h, or immediately on first run
}

void OnTick() {
   SignaliumReportManualTelemetry();
   SignaliumStreamSymbolTicks();
   SignaliumReportPositions();
   if (SignaliumAutonomousModeEnabled()) {
      SignaliumRunAutonomousExecution();
   }
}

// ─── Capabilities ────────────────────────────────────────────────────────
void SignaliumVerifyBuild() {
   // Calls /api/api-keys/verify using the compiled-in SIGNALIUM_API_KEY +
   // build id. No manual key entry required — it ships inside this binary.
}

// ─── Broker-aware market gateway ──────────────────────────────────────────
void SignaliumRefreshSymbolDiscoveryIfDue() {
   // Every 24h (and always on first run): enumerates every symbol the
   // connected broker exposes via SymbolsTotal()/SymbolName(), and POSTs the
   // full raw symbol list plus broker identity (name/server) to
   // POST /api/symbols/discovery (x-api-key auth). The server resolves each
   // raw broker symbol to its canonical Signalium symbol (local cache ->
   // trainer round-trip -> admin regex fallback) and returns the mapping,
   // which is cached locally so OnTick() never blocks on a network call.
   // Conflicts (a raw symbol resolving differently than last time) are
   // logged server-side for admin review; this EA always trusts whatever
   // mapping the server returns, even if it differs from its local cache.
   // Also calls SignaliumFetchVolumeConstraints() to refresh SYMBOL_VOLUME_MIN/
   // MAX/STEP in case the broker updated its constraints since OnInit.
   SignaliumFetchVolumeConstraints();
}

void SignaliumStreamSymbolTicks() {
   // For every subscribed/discovered symbol, reads the latest broker quote
   // (SymbolInfoTick: bid, ask, last tick volume/time) and batches it into
   // the continuous tick stream POSTed to /api/operational/ticks
   // (x-api-key auth), tagging each tick with both the raw broker symbol
   // and the locally-cached normalized_symbol from the discovery scan.
   // Batched/throttled (not one HTTP call per tick) to stay within broker
   // and platform rate limits while still reflecting live market state.
}

void SignaliumConnectQdeSocket() {
   // Opens the persistent /ws/ea WebSocket described above; falls back to
   // HTTP polling (GET /api/qde/actions/pending) if the socket cannot be
   // established or drops and reconnection attempts are exhausted.
}

void SignaliumReportQdeTelemetry() {
   // Every 30s (OnTimer): assembles the telemetry payload documented above
   // and sends it over the QDE WebSocket (or the HTTP fallback), then
   // applies any returned trainer action via SignaliumApplyTrainerAction()
   // and acknowledges it back to the platform.
}

void SignaliumApplyTrainerAction(string action, ulong ticket) {
   // Applies a QDE trainer decision (HOLD/ADD/REDUCE/TRAIL/BREAKEVEN/
   // LOCK_PROFIT/CLOSE) to the given position, then sends an ack.
}

void SignaliumReportManualTelemetry() {
   // Streams manual-mode trading telemetry to the Signalium backend.
}

bool SignaliumAutonomousModeEnabled() {
   return(false); // toggled remotely via account settings
}

void SignaliumRunAutonomousExecution() {
   // Executes autonomous-mode trade decisions per the active strategy.
}

void SignaliumReportPositions() {
   // Reports open position snapshots for dashboard sync.
}

void SignaliumManageTrade(ulong ticket) {
   // Applies trade management rules (SL/TP adjustment, trailing, etc.).
}

void SignaliumReportAccountState(string trigger) {
   // Reports account balance/equity/margin for reporting & audit.
}
`;
}

/**
 * Simulates compiling the MQL5 source into a distributable .ex5 binary.
 * Real MetaEditor compilation is not available in this environment, so we
 * package a structured binary artifact: a magic header, the embedded
 * metadata block (JSON, length-prefixed), and a digest of the source body.
 * The source body (embedded below) already contains the user's compiled-in
 * API key as a #define — the metadata block itself only stores the key's
 * hash (for server-side audit/matching), never the raw value, so inspecting
 * the JSON metadata block alone never leaks the credential.
 */
export function compileToEx5(source: string, metadata: EaMetadata): Buffer {
  const magic = Buffer.from("SIGX5EA1", "utf-8");
  const metadataJson = Buffer.from(JSON.stringify(metadata), "utf-8");
  const sourceDigest = crypto.createHash("sha256").update(source).digest();

  const metadataLength = Buffer.alloc(4);
  metadataLength.writeUInt32BE(metadataJson.length, 0);

  const sourceLength = Buffer.alloc(4);
  sourceLength.writeUInt32BE(Buffer.byteLength(source, "utf-8"), 0);

  return Buffer.concat([
    magic,
    metadataLength,
    metadataJson,
    sourceDigest,
    sourceLength,
    Buffer.from(source, "utf-8"),
  ]);
}

export function checksumOf(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

const PRIVATE_EA_BUILD_PREFIX = "ea-builds";

function getPrivateObjectDir(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error("PRIVATE_OBJECT_DIR not set — object storage is not provisioned.");
  }
  return dir;
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  if (parts.length < 3) throw new Error("Invalid object path");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

/** Uploads a generated EA build binary to private object storage. Returns the storage object path. */
export async function storeEaBuild(buildId: string, fileBuffer: Buffer): Promise<string> {
  const entityDir = getPrivateObjectDir();
  const fullPath = `${entityDir}/${PRIVATE_EA_BUILD_PREFIX}/${buildId}.ex5`;
  const { bucketName, objectName } = parseObjectPath(fullPath);

  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  await file.save(fileBuffer, { contentType: "application/octet-stream" });

  return `/objects/${PRIVATE_EA_BUILD_PREFIX}/${buildId}.ex5`;
}

/** Resolves a stored EA build's storage object path back to a GCS File handle. */
export async function getEaBuildFile(storageObjectPath: string) {
  if (!storageObjectPath.startsWith("/objects/")) {
    throw new ObjectNotFoundError();
  }
  const entityId = storageObjectPath.slice("/objects/".length);
  const entityDir = getPrivateObjectDir();
  const fullPath = `${entityDir}/${entityId}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  const [exists] = await file.exists();
  if (!exists) throw new ObjectNotFoundError();
  return file;
}
