/**
 * AES-256-GCM encryption at rest for operator-entered secrets stored in the
 * `admin_secrets` table (third-party API keys, webhook secrets, etc. that
 * need an in-app, auditable, encrypted store — separate from process.env
 * Replit secrets, which have no in-app visibility for admins).
 *
 * Keyed by SECRETS_ENCRYPTION_KEY if set, else derived from SESSION_SECRET
 * (already a rotated, managed secret) via scrypt so we don't require a
 * brand-new secret just to ship this feature.
 */
import crypto from "crypto";

function getKey(): Buffer {
  const explicit = process.env.SECRETS_ENCRYPTION_KEY;
  const source = explicit || process.env.SESSION_SECRET;
  if (!source) throw new Error("SECRETS_ENCRYPTION_KEY or SESSION_SECRET must be set to encrypt admin secrets");
  return crypto.scryptSync(source, "signalium-admin-secrets-vault", 32);
}

/** Encrypts plaintext, returning `iv:authTag:ciphertext` (all hex). */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptSecret(encrypted: string): string {
  const key = getKey();
  const [ivHex, tagHex, dataHex] = encrypted.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Malformed encrypted secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Masks a secret value for display in lists — shows only a short suffix. */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return "••••";
  return `••••••••${plaintext.slice(-4)}`;
}
