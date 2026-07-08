import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, apiKeysTable, subscriptionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// List current user's API keys
router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const keys = await db.select({
      id: apiKeysTable.id,
      name: apiKeysTable.name,
      keyPrefix: apiKeysTable.keyPrefix,
      isActive: apiKeysTable.isActive,
      lastUsedAt: apiKeysTable.lastUsedAt,
      createdAt: apiKeysTable.createdAt,
    }).from(apiKeysTable).where(eq(apiKeysTable.userId, userId));
    return res.json(keys);
  } catch (err) {
    req.log.error(err, "Failed to list API keys");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Create a new API key — requires active subscription
router.post("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { name } = req.body as { name?: string };
  if (!name) return res.status(400).json({ error: "name required" });

  try {
    // Verify active subscription
    const [sub] = await db.select().from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.userId, userId), eq(subscriptionsTable.status, "active")));
    if (!sub) return res.status(403).json({ error: "Active subscription required to generate API keys" });

    const rawKey = `sig_${crypto.randomBytes(32).toString("hex")}`;
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12) + "...";

    const [keyRow] = await db.insert(apiKeysTable).values({
      userId,
      name,
      keyHash,
      keyPrefix,
      isActive: true,
    }).returning();

    // Return full key ONCE — never stored in plaintext
    return res.status(201).json({
      id: keyRow.id,
      name: keyRow.name,
      key: rawKey,
      keyPrefix: keyRow.keyPrefix,
      isActive: keyRow.isActive,
      createdAt: keyRow.createdAt,
      warning: "Save this key — it will not be shown again.",
    });
  } catch (err) {
    req.log.error(err, "Failed to create API key");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Revoke an API key
router.delete("/:id", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [key] = await db.update(apiKeysTable)
      .set({ isActive: false })
      .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.userId, userId)))
      .returning();
    if (!key) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "Failed to revoke API key");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Verify an API key — used by EA runtime (public endpoint, key in header)
router.post("/verify", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string | undefined
    ?? (req.body as { key?: string }).key;
  if (!apiKey) return res.status(400).json({ error: "API key required" });

  try {
    const keyHash = hashKey(apiKey);
    const [key] = await db.select().from(apiKeysTable)
      .where(and(eq(apiKeysTable.keyHash, keyHash), eq(apiKeysTable.isActive, true)));
    if (!key) return res.status(401).json({ error: "Invalid or inactive API key" });

    // Check subscription is still active
    const [sub] = await db.select().from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.userId, key.userId), eq(subscriptionsTable.status, "active")));
    if (!sub) return res.status(403).json({ error: "No active subscription for this key" });

    await db.update(apiKeysTable).set({ lastUsedAt: new Date() }).where(eq(apiKeysTable.id, key.id));

    return res.json({ ok: true, userId: key.userId, keyId: key.id });
  } catch (err) {
    req.log.error(err, "Failed to verify API key");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
