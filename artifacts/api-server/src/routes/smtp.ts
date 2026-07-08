import { Router } from "express";
import { db, smtpSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// GET /smtp — admin: get current SMTP config (masked password)
router.get("/", async (req, res) => {
  try {
    const [settings] = await db.select().from(smtpSettingsTable).where(eq(smtpSettingsTable.isActive, true));
    if (!settings) return res.json(null);
    return res.json({ ...settings, password: "••••••••" });
  } catch (err) {
    req.log.error(err, "Failed to get SMTP settings");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /smtp/all — admin: list all configs
router.get("/all", async (req, res) => {
  try {
    const settings = await db.select().from(smtpSettingsTable).orderBy(smtpSettingsTable.createdAt);
    return res.json(settings.map(s => ({ ...s, password: "••••••••" })));
  } catch (err) {
    req.log.error(err, "Failed to list SMTP settings");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /smtp — admin: create new SMTP config
router.post("/", async (req, res) => {
  const { host, port, username, password, fromEmail, fromName, useTls, isActive } = req.body as {
    host: string; port?: number; username: string; password: string;
    fromEmail: string; fromName?: string; useTls?: boolean; isActive?: boolean;
  };
  if (!host || !username || !password || !fromEmail) {
    return res.status(400).json({ error: "host, username, password, fromEmail required" });
  }

  try {
    if (isActive) {
      await db.update(smtpSettingsTable).set({ isActive: false, updatedAt: new Date() });
    }
    const [settings] = await db.insert(smtpSettingsTable).values({
      host, port: port ?? 587, username, password, fromEmail,
      fromName: fromName ?? "Signalium",
      useTls: useTls ?? true,
      isActive: isActive ?? false,
    }).returning();
    return res.status(201).json({ ...settings, password: "••••••••" });
  } catch (err) {
    req.log.error(err, "Failed to create SMTP settings");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /smtp/:id — admin: update SMTP config
router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { host, port, username, password, fromEmail, fromName, useTls, isActive } = req.body as {
    host?: string; port?: number; username?: string; password?: string;
    fromEmail?: string; fromName?: string; useTls?: boolean; isActive?: boolean;
  };

  try {
    if (isActive) {
      await db.update(smtpSettingsTable).set({ isActive: false, updatedAt: new Date() });
    }
    const [settings] = await db.update(smtpSettingsTable)
      .set({
        ...(host && { host }), ...(port && { port }), ...(username && { username }),
        ...(password && { password }), ...(fromEmail && { fromEmail }),
        ...(fromName && { fromName }), ...(useTls !== undefined && { useTls }),
        ...(isActive !== undefined && { isActive }), updatedAt: new Date(),
      })
      .where(eq(smtpSettingsTable.id, id))
      .returning();
    if (!settings) return res.status(404).json({ error: "Not found" });
    return res.json({ ...settings, password: "••••••••" });
  } catch (err) {
    req.log.error(err, "Failed to update SMTP settings");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /smtp/:id
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    await db.delete(smtpSettingsTable).where(eq(smtpSettingsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete SMTP settings");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /smtp/test — admin: test the active SMTP config
router.post("/test", async (req, res) => {
  const { to } = req.body as { to?: string };
  if (!to) return res.status(400).json({ error: "to email required" });

  try {
    const [settings] = await db.select().from(smtpSettingsTable).where(eq(smtpSettingsTable.isActive, true));
    if (!settings) return res.status(400).json({ error: "No active SMTP configuration" });
    return res.json({ ok: true, message: `Test email would be sent to ${to} via ${settings.host}:${settings.port}` });
  } catch (err) {
    req.log.error(err, "Failed to test SMTP");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
