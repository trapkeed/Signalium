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

/** Derives a filesystem/EA-safe username from a Clerk user's profile fields. */
export function deriveUsername(user: { firstName?: string | null; lastName?: string | null; email: string }): string {
  const base = user.firstName || user.email.split("@")[0] || "trader";
  const safe = base.replace(/[^a-zA-Z0-9]/g, "");
  return safe.length > 0 ? safe : "Trader";
}

export function buildFileName(username: string): string {
  return `Signalium_${username}_MT5.ex5`;
}

/**
 * Generates the MQL5 source for the user's EA. This is the human-readable
 * template with embedded metadata (as commented constants, never the raw
 * API key) and stub implementations of the required capabilities.
 */
export function generateMql5Source(metadata: EaMetadata): string {
  return `//+------------------------------------------------------------------+
//|                                         Signalium Expert Advisor |
//|                   Auto-generated — do not edit embedded metadata |
//+------------------------------------------------------------------+
#property copyright "Signalium"
#property version   "1.00"
#property strict

// ─── Embedded build metadata (read-only, verified server-side) ─────────────
// Never contains the raw API key — only its SHA-256 hash.
#define SIGNALIUM_USER_ID            "${metadata.userId}"
#define SIGNALIUM_API_KEY_HASH       "${metadata.apiKeyHash}"
#define SIGNALIUM_BUILD_ID           "${metadata.buildId}"
#define SIGNALIUM_SUBSCRIPTION_TIER  "${metadata.subscriptionTier}"
#define SIGNALIUM_GENERATED_AT       "${metadata.generationTimestamp}"
#define SIGNALIUM_PLATFORM_VERSION   "${metadata.platformVersion}"

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
}

void OnTick() {
   SignaliumReportManualTelemetry();
   SignaliumReportPositions();
   if (SignaliumAutonomousModeEnabled()) {
      SignaliumRunAutonomousExecution();
   }
}

// ─── Capabilities ────────────────────────────────────────────────────────
void SignaliumVerifyBuild() {
   // Calls /api/api-keys/verify using the locally-stored raw key + build id.
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
 * This keeps the artifact byte-identical per build and inspectable for
 * audit purposes, while never embedding the raw API key.
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
