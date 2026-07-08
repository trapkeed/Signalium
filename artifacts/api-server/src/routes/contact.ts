import { Router } from "express";
import { db, contactMessagesTable, smtpSettingsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { sendMail } from "../lib/mailer";

const router = Router();

// POST /contact — public: submit the contact form. Stored for the admin
// queue below, and forwarded by email to the configured SMTP "from" address
// (i.e. the support inbox) when an active SMTP configuration exists.
router.post("/", async (req, res) => {
  const { name, email, subject, message } = req.body as { name?: string; email?: string; subject?: string; message?: string };
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: "name, email, subject, and message are required" });
  }

  try {
    const [contactMessage] = await db.insert(contactMessagesTable).values({ name, email, subject, message }).returning();

    const [smtp] = await db.select().from(smtpSettingsTable).where(eq(smtpSettingsTable.isActive, true));
    if (smtp) {
      void sendMail({
        to: smtp.fromEmail,
        subject: `[Contact] ${subject}`,
        html: `<p><strong>From:</strong> ${name} (${email})</p><p><strong>Subject:</strong> ${subject}</p><p>${message.replace(/\n/g, "<br/>")}</p>`,
      });
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
