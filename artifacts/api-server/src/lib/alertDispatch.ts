/**
 * S23b — Alert Delivery Dispatch
 *
 * Fans a newly-created `platform_alerts` row out to the configured delivery
 * channels (dashboard is implicit — the alert row itself). Email is always
 * attempted via the existing SMTP config (`sendMail`); Telegram/Discord are
 * attempted only when their credentials exist as environment secrets, so we
 * never fabricate a "sent" status for a channel that isn't actually wired up.
 *
 * Every attempt (including "not configured") is recorded in
 * `alert_delivery_log` so the Alerts admin page can show real per-channel
 * status instead of guessing from the alert row alone.
 */

import { db, alertDeliveryLogTable, alertChannelSettingsTable, type PlatformAlert } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendMail } from "./mailer";
import { logger } from "./logger";

type Channel = "email" | "telegram" | "discord";
type DeliveryStatus = "sent" | "failed" | "skipped" | "not_configured";

async function recordDelivery(alertId: number, channel: Channel, status: DeliveryStatus, detail?: string) {
  try {
    await db
      .insert(alertDeliveryLogTable)
      .values({ alertId, channel, status, detail: detail ?? null })
      .onConflictDoUpdate({
        target: [alertDeliveryLogTable.alertId, alertDeliveryLogTable.channel],
        set: { status, detail: detail ?? null, createdAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err, alertId, channel }, "Failed to record alert delivery log entry");
  }
}

/** Fetches (and lazily creates) the singleton channel-settings row. */
export async function getAlertChannelSettings() {
  const [existing] = await db.select().from(alertChannelSettingsTable).where(eq(alertChannelSettingsTable.id, "global"));
  if (existing) return existing;
  const [created] = await db
    .insert(alertChannelSettingsTable)
    .values({ id: "global" })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await db.select().from(alertChannelSettingsTable).where(eq(alertChannelSettingsTable.id, "global"));
  return row!;
}

function severityLabel(severity: PlatformAlert["severity"]): string {
  return severity.toUpperCase();
}

async function dispatchEmail(alert: PlatformAlert, recipients: string[]): Promise<void> {
  if (recipients.length === 0) {
    await recordDelivery(alert.id, "email", "skipped", "No recipients configured");
    return;
  }
  const subject = `[Signalium ${severityLabel(alert.severity)}] ${alert.type.replace(/_/g, " ")}`;
  const html = `<p><strong>${severityLabel(alert.severity)}</strong>: ${alert.message}</p><p>Type: ${alert.type}</p><p>Time: ${alert.createdAt.toISOString()}</p>`;

  const results = await Promise.all(
    recipients.map(async (to) => {
      try {
        return await sendMail({ to, subject, html });
      } catch {
        return false;
      }
    }),
  );
  const anySent = results.some(Boolean);
  await recordDelivery(
    alert.id,
    "email",
    anySent ? "sent" : "failed",
    anySent ? undefined : "SMTP not configured or send failed",
  );
}

async function dispatchTelegram(alert: PlatformAlert): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) {
    await recordDelivery(alert.id, "telegram", "not_configured", "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set");
    return;
  }
  try {
    const text = `[${severityLabel(alert.severity)}] ${alert.type.replace(/_/g, " ")}\n${alert.message}`;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) throw new Error(`Telegram API responded ${res.status}`);
    await recordDelivery(alert.id, "telegram", "sent");
  } catch (err) {
    logger.warn({ err, alertId: alert.id }, "Telegram alert delivery failed");
    await recordDelivery(alert.id, "telegram", "failed", err instanceof Error ? err.message : "Unknown error");
  }
}

async function dispatchDiscord(alert: PlatformAlert): Promise<void> {
  const webhookUrl = process.env["DISCORD_WEBHOOK_URL"];
  if (!webhookUrl) {
    await recordDelivery(alert.id, "discord", "not_configured", "DISCORD_WEBHOOK_URL not set");
    return;
  }
  try {
    const content = `**[${severityLabel(alert.severity)}] ${alert.type.replace(/_/g, " ")}**\n${alert.message}`;
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(`Discord webhook responded ${res.status}`);
    await recordDelivery(alert.id, "discord", "sent");
  } catch (err) {
    logger.warn({ err, alertId: alert.id }, "Discord alert delivery failed");
    await recordDelivery(alert.id, "discord", "failed", err instanceof Error ? err.message : "Unknown error");
  }
}

/**
 * Dispatches a freshly-created platform alert to all enabled channels.
 * Never throws — delivery failures are logged per-channel, not surfaced to
 * the caller, so a broken delivery channel never blocks alert creation.
 */
export async function dispatchAlert(alert: PlatformAlert): Promise<void> {
  try {
    const settings = await getAlertChannelSettings();
    const tasks: Promise<void>[] = [];
    if (settings.emailEnabled) tasks.push(dispatchEmail(alert, settings.emailRecipients));
    else tasks.push(recordDelivery(alert.id, "email", "skipped", "Email channel disabled"));

    if (settings.telegramEnabled) tasks.push(dispatchTelegram(alert));
    else tasks.push(recordDelivery(alert.id, "telegram", "skipped", "Telegram channel disabled"));

    if (settings.discordEnabled) tasks.push(dispatchDiscord(alert));
    else tasks.push(recordDelivery(alert.id, "discord", "skipped", "Discord channel disabled"));

    await Promise.all(tasks);
  } catch (err) {
    logger.warn({ err, alertId: alert.id }, "Alert dispatch failed");
  }
}
