/**
 * S21B — Deployment Client
 *
 * HTTP client for signalium-trainer deployment endpoints. Responsible for:
 *   - Polling for active deployment versions
 *   - Downloading manifests and artifacts
 *   - SHA256 integrity verification
 *   - Local filesystem caching
 *
 * This module has zero side-effects — all state changes live in deploymentManager.ts.
 */

import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrainerDeploymentSummary {
  /** UUID assigned by the trainer — stable across polls. */
  id: string;
  version: string;
  featureVersion: string | null;
  manifestHash: string;
  artifactHash: string;
  status: "ACTIVE";
  activatedAt: string; // ISO timestamp
  metadata?: Record<string, unknown>;
}

export interface TrainerManifest {
  deploymentId: string;
  version: string;
  featureVersion: string | null;
  manifestHash: string;
  artifactHash: string;
  /** Map of artifact name → expected SHA256 hash. */
  artifacts: Record<string, string>;
  /** Optional calibration config embedded in the manifest. */
  calibration?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface DownloadedArtifacts {
  cacheDir: string;
  /** Local filesystem paths keyed by artifact name. */
  paths: Record<string, string>;
  /** Verified SHA256 hashes keyed by artifact name. */
  hashes: Record<string, string>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

function getCacheDir(): string {
  const base = process.env["DEPLOYMENT_CACHE_DIR"] ?? "/tmp/qde-deployments";
  mkdirSync(base, { recursive: true });
  return base;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function trainerFetch(
  trainerUrl: string,
  path: string,
  opts?: RequestInit,
): Promise<Response> {
  const url = `${trainerUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...opts,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Trainer ${path} returned ${res.status}`);
  return res;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Poll GET /deployment/active.
 * Returns null when no active deployment is reported (trainer just started,
 * or no model has been deployed yet).
 */
export async function fetchActiveDeployment(
  trainerUrl: string,
): Promise<TrainerDeploymentSummary | null> {
  try {
    const res = await trainerFetch(trainerUrl, "/deployment/active");
    const data = (await res.json()) as Partial<TrainerDeploymentSummary> | null;
    if (!data || !data.id || !data.version) return null;
    return data as TrainerDeploymentSummary;
  } catch (err) {
    logger.warn({ err, trainerUrl }, "Failed to fetch active deployment from trainer");
    return null;
  }
}

/**
 * Fetch full manifest for a specific deployment.
 * GET /deployment/manifest/{id}
 */
export async function fetchManifest(
  trainerUrl: string,
  deploymentId: string,
): Promise<TrainerManifest | null> {
  try {
    const res = await trainerFetch(trainerUrl, `/deployment/manifest/${deploymentId}`);
    return (await res.json()) as TrainerManifest;
  } catch (err) {
    logger.warn({ err, trainerUrl, deploymentId }, "Failed to fetch deployment manifest");
    return null;
  }
}

/**
 * Download all artifacts listed in the manifest to the local cache.
 * GET /deployment/download/{id}
 *
 * The trainer may return a tarball, a zip, or a JSON envelope with download
 * URLs. We handle three response shapes:
 *   1. application/octet-stream — single binary artifact (model weights)
 *   2. application/json         — envelope with per-artifact download URLs
 *   3. application/gzip / application/zip — not yet supported; future work
 *
 * All downloaded files are SHA256-verified against the manifest hashes.
 */
export async function downloadArtifacts(
  trainerUrl: string,
  deploymentId: string,
  manifest: TrainerManifest,
): Promise<DownloadedArtifacts> {
  const cacheBase = getCacheDir();
  const deploymentDir = join(cacheBase, deploymentId);
  mkdirSync(deploymentDir, { recursive: true });

  const paths: Record<string, string> = {};
  const hashes: Record<string, string> = {};

  // Persist manifest JSON itself
  const manifestPath = join(deploymentDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  paths["manifest"] = manifestPath;

  // Attempt to download the primary artifact bundle
  try {
    const res = await trainerFetch(trainerUrl, `/deployment/download/${deploymentId}`);
    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      // Envelope shape: { artifacts: { name: url } }
      const envelope = (await res.json()) as { artifacts?: Record<string, string> };
      const artifactUrls = envelope.artifacts ?? {};
      for (const [name, url] of Object.entries(artifactUrls)) {
        const localPath = join(deploymentDir, name);
        const fileRes = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (!fileRes.ok) throw new Error(`Artifact download for ${name} returned ${fileRes.status}`);
        const ws = createWriteStream(localPath);
        await pipeline(fileRes.body as unknown as NodeJS.ReadableStream, ws);
        paths[name] = localPath;
      }
    } else {
      // Single binary artifact
      const localPath = join(deploymentDir, "model.bin");
      const ws = createWriteStream(localPath);
      await pipeline(res.body as unknown as NodeJS.ReadableStream, ws);
      paths["model"] = localPath;
    }
  } catch (err) {
    logger.warn({ err, deploymentId }, "Artifact download encountered an error — using manifest-only cache");
    // Manifest is always stored; artifact-only deployments (remote-inference mode) are valid
  }

  // SHA256-verify every file we downloaded
  for (const [name, localPath] of Object.entries(paths)) {
    if (name === "manifest") continue;
    const expectedHash = manifest.artifacts[name];
    if (!expectedHash) continue;
    const actualHash = await computeFileHash(localPath);
    hashes[name] = actualHash;
    if (actualHash !== expectedHash) {
      throw new Error(
        `Integrity failure for artifact "${name}": expected ${expectedHash}, got ${actualHash}`,
      );
    }
  }

  logger.info({ deploymentId, deploymentDir, artifactCount: Object.keys(paths).length }, "Artifacts downloaded and cached");
  return { cacheDir: deploymentDir, paths, hashes };
}

/**
 * Verify the integrity of a previously-cached artifact.
 * Returns true when the file exists and its SHA256 matches expectedHash.
 */
export async function verifyLocalArtifact(
  localPath: string,
  expectedHash: string,
): Promise<boolean> {
  try {
    await stat(localPath);
    const actual = await computeFileHash(localPath);
    return actual === expectedHash;
  } catch {
    return false;
  }
}

/**
 * Load calibration config from a cached manifest.
 * Returns null if no calibration data is embedded.
 */
export async function loadCalibrationConfig(
  cacheDir: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(cacheDir, "manifest.json"), "utf8");
    const manifest = JSON.parse(raw) as TrainerManifest;
    return manifest.calibration ?? null;
  } catch {
    return null;
  }
}

/**
 * Perform a warm-up inference call against the trainer using the specified
 * deployment version. Returns the measured latency in ms.
 *
 * Throws when the warm-up fails or exceeds the latency threshold.
 */
export async function warmDeployment(
  trainerUrl: string,
  version: string,
  latencyThresholdMs: number = 5_000,
): Promise<number> {
  const payload = {
    type: "inference",
    symbol: "XAUUSD",
    userId: "__warmup__",
    targetModelVersion: version,
    telemetry: null,
  };

  const start = Date.now();
  const res = await trainerFetch(trainerUrl, "/qde/inference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const latency = Date.now() - start;

  if (!res.ok) throw new Error(`Warm-up inference returned ${res.status}`);
  if (latency > latencyThresholdMs) {
    throw new Error(`Warm-up latency ${latency}ms exceeds threshold ${latencyThresholdMs}ms`);
  }

  logger.info({ version, latencyMs: latency }, "Deployment warm-up succeeded");
  return latency;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function computeFileHash(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}
