import nodemailer from "nodemailer";
import { db, smtpSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Sends an email using the active `smtp_settings` row, if one exists. Used
 * for account-security notifications (suspicious login, account lock,
 * unlock link). No-ops with a warning log when SMTP isn't configured yet, or
 * when sending fails, so security detection logic never throws because of
 * email delivery — the in-app security timeline is the source of truth.
 */
export async function sendMail(opts: { to: string; subject: string; html: string }): Promise<boolean> {
  try {
    const [settings] = await db.select().from(smtpSettingsTable).where(eq(smtpSettingsTable.isActive, true));
    if (!settings) {
      logger.warn({ to: opts.to, subject: opts.subject }, "sendMail skipped — no active SMTP configuration");
      return false;
    }

    const transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.useTls && settings.port === 465,
      auth: { user: settings.username, pass: settings.password },
    });

    await transporter.sendMail({
      from: `"${settings.fromName}" <${settings.fromEmail}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return true;
  } catch (err) {
    logger.error(err, "Failed to send email");
    return false;
  }
}
