import { Router } from "express";
import { db, easTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateEaBody,
  UpdateEaBody,
  GetEaParams,
  UpdateEaParams,
  DeleteEaParams,
  GetEaDownloadTokenParams,
} from "@workspace/api-zod";
import crypto from "crypto";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

// S29 — the catalog listing/detail views are intentionally public (browsing
// available EAs is part of the marketing/pricing flow), but creating,
// editing, or deleting catalog entries had no auth at all — restrict those
// to admins below.

router.get("/", async (req, res) => {
  try {
    const eas = await db.select().from(easTable).orderBy(easTable.createdAt);
    return res.json(eas);
  } catch (err) {
    req.log.error(err, "Failed to list EAs");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  const parsed = CreateEaBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  try {
    const [ea] = await db.insert(easTable).values({
      name: parsed.data.name,
      description: parsed.data.description,
      version: parsed.data.version,
      platform: parsed.data.platform,
      requiredTier: parsed.data.requiredTier,
      isActive: parsed.data.isActive ?? true,
      changeLog: parsed.data.changeLog,
    }).returning();
    return res.status(201).json(ea);
  } catch (err) {
    req.log.error(err, "Failed to create EA");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const parsed = GetEaParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  try {
    const [ea] = await db.select().from(easTable).where(eq(easTable.id, parsed.data.id));
    if (!ea) return res.status(404).json({ error: "Not found" });
    return res.json(ea);
  } catch (err) {
    req.log.error(err, "Failed to get EA");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const params = UpdateEaParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateEaBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  try {
    const [ea] = await db.update(easTable)
      .set({ ...body.data })
      .where(eq(easTable.id, params.data.id))
      .returning();
    if (!ea) return res.status(404).json({ error: "Not found" });
    return res.json(ea);
  } catch (err) {
    req.log.error(err, "Failed to update EA");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const parsed = DeleteEaParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  try {
    await db.delete(easTable).where(eq(easTable.id, parsed.data.id));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete EA");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/download-token", async (req, res) => {
  const parsed = GetEaDownloadTokenParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  try {
    const [ea] = await db.select().from(easTable).where(eq(easTable.id, parsed.data.id));
    if (!ea) return res.status(404).json({ error: "Not found" });

    await db.update(easTable)
      .set({ downloadCount: ea.downloadCount + 1 })
      .where(eq(easTable.id, ea.id));

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    return res.json({ token, expiresAt, eaId: ea.id });
  } catch (err) {
    req.log.error(err, "Failed to generate download token");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
