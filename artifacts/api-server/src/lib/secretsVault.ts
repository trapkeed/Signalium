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

/**
 * Reads a single managed secret's decrypted value by key, for server-side
 * consumers (payment providers, trainer client, market data adapters, etc).
 * Returns null if the key has no admin-managed value — callers should fall
 * back to process.env in that case. Lazily imports the db to avoid import
 * cycles with modules that this file itself might be used from.
 */
export async function getManagedSecretValue(key: string): Promise<string | null> {
  const { db, adminSecretsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const [row] = await db.select().from(adminSecretsTable).where(eq(adminSecretsTable.key, key));
  if (!row) return null;
  try {
    return decryptSecret(row.encryptedValue);
  } catch {
    return null;
  }
}

/**
 * Resolves a config value preferring the admin-managed encrypted vault, and
 * falling back to a process.env var if no managed value is set. Use this in
 * provider/client code so operators can configure credentials from the
 * admin panel without needing Replit Secrets access.
 */
export async function resolveManagedConfig(managedKey: string, envVarName?: string): Promise<string | null> {
  const managed = await getManagedSecretValue(managedKey);
  if (managed) return managed;
  if (envVarName && process.env[envVarName]) return process.env[envVarName] as string;
  return null;
}
