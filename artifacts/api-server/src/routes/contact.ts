import { Router } from "express";
import { db, contactMessagesTable, smtpSettingsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

// POST /contact — public: submit the contact form. Stored for the admin
// queue below; if an SMTP config is active we log the notification (actual
// outbound send is not wired up yet — see smtp.ts's own /test stub for the
// same limitation).
router.post("/", async (req, res) => {
  const { name, email, subject, message } = req.body as { name?: string; email?: string; subject?: string; message?: string };
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: "name, email, subject, and message are required" });
  }

  try {
    const [contactMessage] = await db.insert(contactMessagesTable).values({ name, email, subject, message }).returning();

    const [smtp] = await db.select().from(smtpSettingsTable).where(eq(smtpSettingsTable.isActive, true));
    if (smtp) {
      req.log.info({ to: smtp.fromEmail, from: email }, "Contact form submission would be emailed to support");
    }

    return res.status(201).json({ id: contactMessage.id });
  } catch (err) {
    req.log.error(err, "Failed to submit contact form");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /contact/admin — admin: list submissions
router.get("/admin", requireAdmin, async (req, res) => {
  try {
    const messages = await db.select().from(contactMessagesTable).orderBy(desc(contactMessagesTable.createdAt));
    return res.json(messages);
  } catch (err) {
    req.log.error(err, "Failed to list contact messages");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /contact/admin/:id — admin: mark handled/new
router.patch("/admin/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const { status } = req.body as { status?: "new" | "handled" };
  if (!status) return res.status(400).json({ error: "status is required" });

  try {
    const [message] = await db.update(contactMessagesTable).set({ status }).where(eq(contactMessagesTable.id, id)).returning();
    if (!message) return res.status(404).json({ error: "Not found" });
    return res.json(message);
  } catch (err) {
    req.log.error(err, "Failed to update contact message");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
