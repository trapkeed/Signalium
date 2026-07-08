import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, apiKeysTable, eaRegistrationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { isAdmin } from "../middlewares/requireAdmin";

const router = Router();

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// Register (or re-register) an EA terminal against an API key. Public endpoint,
// authenticated via the raw API key (not a Clerk session) — this is what the
// EA calls on startup. Idempotent per (apiKey, hardwareId): re-running it from
// the same machine just refreshes metadata / lastSeenAt. A new hardwareId under
// the same key creates a new row, which is how multiple terminals, VPS
// migration, and hardware replacement are supported.
router.post("/", async (req, res) => {
  const body = req.body as {
    apiKey?: string;
    hardwareId?: string;
    mt5Account?: string;
    brokerName?: string;
    brokerServer?: string;
    terminalBuild?: string;
    platformVersion?: string;
  };
  const apiKey = req.headers["x-api-key"] as string | undefined ?? body.apiKey;
  if (!apiKey) return res.status(400).json({ error: "apiKey required" });
  if (!body.hardwareId) return res.status(400).json({ error: "hardwareId required" });

  try {
    const keyHash = hashKey(apiKey);
    const [key] = await db.select().from(apiKeysTable).where(eq(apiKeysTable.keyHash, keyHash));
    if (!key) return res.status(401).json({ error: "Invalid API key" });
    if (key.status === "active" && key.expiresAt && key.expiresAt.getTime() < Date.now()) {
      await db.update(apiKeysTable).set({ status: "expired" }).where(eq(apiKeysTable.id, key.id));
      return res.status(401).json({ error: "API key is expired" });
    }
    if (key.status !== "active") {
      return res.status(401).json({ error: `API key is ${key.status}` });
    }

    const now = new Date();
    const [registration] = await db.insert(eaRegistrationsTable)
      .values({
        apiKeyId: key.id,
        hardwareId: body.hardwareId,
        mt5Account: body.mt5Account,
        brokerName: body.brokerName,
        brokerServer: body.brokerServer,
        terminalBuild: body.terminalBuild,
        platformVersion: body.platformVersion,
        isActive: true,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [eaRegistrationsTable.apiKeyId, eaRegistrationsTable.hardwareId],
        set: {
          mt5Account: body.mt5Account,
          brokerName: body.brokerName,
          brokerServer: body.brokerServer,
          terminalBuild: body.terminalBuild,
          platformVersion: body.platformVersion,
          isActive: true,
          lastSeenAt: now,
        },
      })
      .returning();

    await db.update(apiKeysTable).set({ lastUsedAt: now }).where(eq(apiKeysTable.id, key.id));

    return res.status(201).json(registration);
  } catch (err) {
    req.log.error(err, "Failed to register EA terminal");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// List the current Clerk user's own EA registrations (across all of their API keys)
router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const rows = await db.select({
      registration: eaRegistrationsTable,
      apiKeyName: apiKeysTable.name,
    })
      .from(eaRegistrationsTable)
      .innerJoin(apiKeysTable, eq(eaRegistrationsTable.apiKeyId, apiKeysTable.id))
      .where(eq(apiKeysTable.userId, userId));

    return res.json(rows.map((r) => ({ ...r.registration, apiKeyName: r.apiKeyName })));
  } catch (err) {
    req.log.error(err, "Failed to list EA registrations");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Deactivate a specific terminal registration — used for hardware replacement
// or to kick a stolen/lost machine off a key without revoking the whole key.
router.patch("/:id/deactivate", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [existing] = await db.select({
      registration: eaRegistrationsTable,
      keyUserId: apiKeysTable.userId,
    })
      .from(eaRegistrationsTable)
      .innerJoin(apiKeysTable, eq(eaRegistrationsTable.apiKeyId, apiKeysTable.id))
      .where(eq(eaRegistrationsTable.id, id));

    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.keyUserId !== userId && !(await isAdmin(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const [registration] = await db.update(eaRegistrationsTable)
      .set({ isActive: false })
      .where(eq(eaRegistrationsTable.id, id))
      .returning();
    return res.json(registration);
  } catch (err) {
    req.log.error(err, "Failed to deactivate EA registration");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
