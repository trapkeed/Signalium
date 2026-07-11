import { Router } from "express";
import { getAuth } from "../lib/auth";
import {
  db,
  apiKeysTable,
  eaBuildsTable,
  eaBuildAuditLogTable,
  usersTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";
import { requireAdmin, isAdmin } from "../middlewares/requireAdmin";
import {
  deriveUsername,
  buildFileName,
  generateMql5Source,
  compileToEx5,
  checksumOf,
  storeEaBuild,
  getEaBuildFile,
  generateBuildApiKey,
  buildSymbolMapForEa,
} from "../lib/eaBuilder";
import { ObjectNotFoundError } from "../lib/objectStorage";
import { checkEaGenerationAccess, resolveCurrentSubscription, type EntitlementDenialCode } from "../lib/entitlementEngine";
import { signArtifact } from "../lib/requestSigning";
import { generateSigningSecret } from "../lib/eaRequestSigning";

const router = Router();

async function logAudit(buildId: number, userId: string, action: "generated" | "downloaded" | "regenerated" | "revoked", detail?: Record<string, unknown>) {
  await db.insert(eaBuildAuditLogTable).values({ buildId, userId, action, detail });
}

class BuildPrerequisiteError extends Error {
  constructor(public code: EntitlementDenialCode | "USER_NOT_FOUND", message: string) {
    super(message);
  }
}

/**
 * Resolves the current display tier (for build metadata only — access is
 * decided entirely by the EntitlementEngine, never by tier name) for a user.
 * Throws BuildPrerequisiteError if generation isn't currently allowed.
 *
 * Note: this no longer requires a pre-existing active API key — every EA
 * build mints its own dedicated key (see generateBuildApiKey) so the raw
 * value can be compiled directly into the binary and the user never has to
 * create or paste one in manually.
 */
async function resolveBuildPrerequisites(userId: string) {
  const access = await checkEaGenerationAccess(userId);
  if (!access.allowed) {
    throw new BuildPrerequisiteError(access.code, access.message);
  }

  const snapshot = await resolveCurrentSubscription(userId);
  const tier = snapshot?.plan.tier ?? "starter";

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    throw new BuildPrerequisiteError("USER_NOT_FOUND", "User not found.");
  }

  return { tier, user };
}

/** Mints a fresh, build-dedicated API key row and returns it plus the raw key to embed. */
async function issueBuildApiKey(userId: string, buildLabel: string) {
  const { rawKey, keyHash, keyPrefix } = generateBuildApiKey();
  const signingSecret = generateSigningSecret();
  const [keyRow] = await db.insert(apiKeysTable).values({
    userId,
    name: `EA build — ${buildLabel}`,
    keyHash,
    keyPrefix,
    status: "active",
    signingSecret,
  }).returning();
  return { keyRow, rawKey };
}

function prerequisiteErrorResponse(err: unknown): { status: number; body: { error: string; code?: string } } | null {
  if (!(err instanceof BuildPrerequisiteError)) return null;
  if (err.code === "USER_NOT_FOUND") return { status: 404, body: { error: err.message } };
  return { status: 403, body: { error: err.message, code: err.code } };
}

// ─── User-facing ────────────────────────────────────────────────────────────

// Generate a new unique EA build for the current user.
router.post("/generate", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { tier, user } = await resolveBuildPrerequisites(userId);

    const username = deriveUsername(user);
    const buildId = crypto.randomUUID();
    const { keyRow: apiKey, rawKey } = await issueBuildApiKey(userId, buildId);
    const fileName = buildFileName(username, apiKey.keyHash);

    const metadata = {
      userId,
      apiKeyHash: apiKey.keyHash,
      buildId,
      subscriptionTier: tier,
      generationTimestamp: new Date().toISOString(),
      platformVersion: "MT5",
    };

    // Embed the current canonical symbol map and any broker-specific overrides
    // so the EA has an offline fallback before its first 24h discovery scan.
    const symbolMap = await buildSymbolMapForEa();
    const source = generateMql5Source(metadata, { apiKey: rawKey, hardwareBindingHint: "bound on first EA connect" }, symbolMap);
    const binary = compileToEx5(source, metadata);
    const checksum = checksumOf(binary);
    // S29 — checksum alone only detects accidental corruption; it doesn't
    // prove the artifact came from this server unmodified, since anyone
    // could recompute a checksum for a tampered file. Sign it with a server
    // secret (SESSION_SECRET-keyed, see requestSigning.ts) so
    // `verifyEaBuildSignature` below can be used at connect-time to reject
    // tampered/re-packaged binaries.
    const signature = signArtifact(checksum);
    const storageObjectPath = await storeEaBuild(buildId, binary);

    const [build] = await db.insert(eaBuildsTable).values({
      userId,
      apiKeyId: apiKey.id,
      buildId,
      fileName,
      platform: "mt5",
      platformVersion: "MT5",
      subscriptionTier: tier,
      status: "active",
      metadata,
      storageObjectPath,
      checksum,
      signature,
      fileSizeBytes: binary.length,
    }).returning();

    await logAudit(build.id, userId, "generated", { fileName, checksum, signed: true });

    return res.status(201).json(build);
  } catch (err) {
    const known = prerequisiteErrorResponse(err);
    if (known) return res.status(known.status).json(known.body);
    req.log.error(err, "Failed to generate EA build");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// List the current user's EA builds.
router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const builds = await db.select().from(eaBuildsTable).where(eq(eaBuildsTable.userId, userId)).orderBy(desc(eaBuildsTable.generatedAt));
    return res.json(builds);
  } catch (err) {
    req.log.error(err, "Failed to list EA builds");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin (must be declared before the /:buildId/* routes below, or Express
// would match "admin" as a buildId) ─────────────────────────────────────────

// List all EA builds across all users.
router.get("/admin/all", requireAdmin, async (req, res) => {
  try {
    const builds = await db.select().from(eaBuildsTable).orderBy(desc(eaBuildsTable.generatedAt));
    return res.json(builds);
  } catch (err) {
    req.log.error(err, "Failed to list all EA builds");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Global audit log across all builds.
router.get("/admin/audit", requireAdmin, async (req, res) => {
  try {
    const entries = await db.select({
      auditLog: eaBuildAuditLogTable,
      fileName: eaBuildsTable.fileName,
      buildIdentifier: eaBuildsTable.buildId,
    })
      .from(eaBuildAuditLogTable)
      .innerJoin(eaBuildsTable, eq(eaBuildAuditLogTable.buildId, eaBuildsTable.id))
      .orderBy(desc(eaBuildAuditLogTable.createdAt));

    return res.json(entries.map((e) => ({ ...e.auditLog, fileName: e.fileName, buildIdentifier: e.buildIdentifier })));
  } catch (err) {
    req.log.error(err, "Failed to fetch global EA build audit log");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Download a build's .ex5 file (owner or admin).
router.get("/:buildId/download", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { buildId } = req.params;

  try {
    const [build] = await db.select().from(eaBuildsTable).where(eq(eaBuildsTable.buildId, buildId));
    if (!build) return res.status(404).json({ error: "Not found" });
    if (build.userId !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (build.status === "revoked") {
      return res.status(410).json({ error: "This build has been revoked. Regenerate to get a fresh EA." });
    }

    const file = await getEaBuildFile(build.storageObjectPath);
    const [metadata] = await file.getMetadata();

    await db.update(eaBuildsTable)
      .set({ downloadCount: build.downloadCount + 1, lastDownloadedAt: new Date() })
      .where(eq(eaBuildsTable.id, build.id));
    await logAudit(build.id, userId, "downloaded", { fileName: build.fileName });

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${build.fileName}"`);
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    res.setHeader("X-Ea-Build-Checksum", build.checksum);
    // S29 — signature over the checksum, verifiable with signArtifact-style
    // HMAC against the same checksum (see requestSigning.ts). Lets a
    // downloading client (or the gateway on next connect) prove this build
    // was produced by this server and not re-packaged in transit.
    if (build.signature) res.setHeader("X-Ea-Build-Signature", build.signature);

    const stream = file.createReadStream();
    stream.on("error", (err) => {
      req.log.error(err, "Failed to stream EA build");
      if (!res.headersSent) res.status(500).json({ error: "Failed to stream file" });
    });
    stream.pipe(res);
    return;
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      return res.status(404).json({ error: "Build file not found in storage" });
    }
    req.log.error(err, "Failed to download EA build");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Regenerate a build — supersedes the previous one, refreshes embedded metadata
// (new timestamp, current subscription tier, current active key hash).
router.post("/:buildId/regenerate", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { buildId } = req.params;

  try {
    const [existing] = await db.select().from(eaBuildsTable).where(eq(eaBuildsTable.buildId, buildId));
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.userId !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { tier, user } = await resolveBuildPrerequisites(existing.userId);

    const username = deriveUsername(user);
    const newBuildId = crypto.randomUUID();
    const { keyRow: apiKey, rawKey } = await issueBuildApiKey(existing.userId, newBuildId);
    const fileName = buildFileName(username, apiKey.keyHash);

    const metadata = {
      userId: existing.userId,
      apiKeyHash: apiKey.keyHash,
      buildId: newBuildId,
      subscriptionTier: tier,
      generationTimestamp: new Date().toISOString(),
      platformVersion: "MT5",
    };

    const symbolMap = await buildSymbolMapForEa();
    const source = generateMql5Source(metadata, { apiKey: rawKey, hardwareBindingHint: "bound on first EA connect" }, symbolMap);
    const binary = compileToEx5(source, metadata);
    const checksum = checksumOf(binary);
    const signature = signArtifact(checksum);
    const storageObjectPath = await storeEaBuild(newBuildId, binary);

    const [newBuild] = await db.insert(eaBuildsTable).values({
      userId: existing.userId,
      apiKeyId: apiKey.id,
      buildId: newBuildId,
      fileName,
      platform: "mt5",
      platformVersion: "MT5",
      subscriptionTier: tier,
      status: "active",
      metadata,
      storageObjectPath,
      checksum,
      signature,
      fileSizeBytes: binary.length,
    }).returning();

    await db.update(eaBuildsTable).set({ status: "superseded" }).where(eq(eaBuildsTable.id, existing.id));

    await logAudit(existing.id, userId, "regenerated", { supersededBy: newBuildId });
    await logAudit(newBuild.id, userId, "generated", { fileName, checksum, regeneratedFrom: buildId });

    return res.status(201).json(newBuild);
  } catch (err) {
    const known = prerequisiteErrorResponse(err);
    if (known) return res.status(known.status).json(known.body);
    req.log.error(err, "Failed to regenerate EA build");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Revoke a build (owner or admin) — e.g. suspected leak/compromise.
router.post("/:buildId/revoke", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { buildId } = req.params;

  try {
    const [existing] = await db.select().from(eaBuildsTable).where(eq(eaBuildsTable.buildId, buildId));
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.userId !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const [build] = await db.update(eaBuildsTable)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(eaBuildsTable.id, existing.id))
      .returning();

    await logAudit(build.id, userId, "revoked");

    return res.json(build);
  } catch (err) {
    req.log.error(err, "Failed to revoke EA build");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Audit trail for a specific build (owner or admin).
router.get("/:buildId/audit", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { buildId } = req.params;

  try {
    const [build] = await db.select().from(eaBuildsTable).where(eq(eaBuildsTable.buildId, buildId));
    if (!build) return res.status(404).json({ error: "Not found" });
    if (build.userId !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const entries = await db.select().from(eaBuildAuditLogTable)
      .where(eq(eaBuildAuditLogTable.buildId, build.id))
      .orderBy(desc(eaBuildAuditLogTable.createdAt));

    return res.json(entries);
  } catch (err) {
    req.log.error(err, "Failed to fetch EA build audit log");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
