import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, mediaAssetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const objectStorageService = new ObjectStorageService();

// GET /media — admin: list media assets, optionally filtered by category
router.get("/", requireAdmin, async (req, res) => {
  try {
    const category = req.query.category ? String(req.query.category) : undefined;
    const assets = category
      ? await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.category, category as never)).orderBy(mediaAssetsTable.createdAt)
      : await db.select().from(mediaAssetsTable).orderBy(mediaAssetsTable.createdAt);
    return res.json(assets);
  } catch (err) {
    req.log.error(err, "Failed to list media assets");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /media — admin: register a media asset row after a successful upload
// to object storage (client already has the objectPath from the presigned
// upload flow).
router.post("/", requireAdmin, async (req, res) => {
  const { objectPath, fileName, contentType } = req.body as {
    objectPath?: string;
    fileName?: string;
    contentType?: string;
  };
  if (!objectPath || !fileName || !contentType) {
    return res.status(400).json({ error: "objectPath, fileName, and contentType are required" });
  }

  try {
    const { userId } = getAuth(req);

    // Media library assets back public-facing SEO surfaces (favicon, OG
    // images, sitemaps read by crawlers), so they're intentionally marked
    // public — otherwise GET /storage/objects/* would 403 everyone but the
    // uploading admin, breaking the whole point of the library.
    await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
      owner: userId ?? "unknown",
      visibility: "public",
    });

    const [asset] = await db
      .insert(mediaAssetsTable)
      .values({ ...req.body, uploadedBy: userId ?? null })
      .returning();
    return res.status(201).json(asset);
  } catch (err) {
    req.log.error(err, "Failed to register media asset");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /media/:id — admin
router.delete("/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [asset] = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, id));
    if (asset) {
      await objectStorageService.deleteObjectEntity(asset.objectPath);
    }
    await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete media asset");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
