/**
 * "Continue with Google" — direct OAuth 2.0 authorization-code flow (no
 * Clerk, no @react-oauth/google — just the raw endpoints). Client
 * ID/secret are admin-configured and encrypted at rest in
 * `oauth_credentials` (see secretsVault.ts), not process.env, so an
 * operator can turn this on from the admin panel without a redeploy.
 */
import { db, oauthCredentialsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "./secretsVault";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

export async function getGoogleCredentials(): Promise<GoogleCredentials | null> {
  const [row] = await db.select().from(oauthCredentialsTable).where(eq(oauthCredentialsTable.provider, "google"));
  if (!row || !row.isEnabled) return null;
  try {
    return { clientId: decryptSecret(row.encryptedClientId), clientSecret: decryptSecret(row.encryptedClientSecret) };
  } catch {
    return null;
  }
}

export async function setGoogleCredentials(clientId: string, clientSecret: string, updatedBy: string): Promise<void> {
  const encryptedClientId = encryptSecret(clientId);
  const encryptedClientSecret = encryptSecret(clientSecret);
  await db.insert(oauthCredentialsTable).values({
    provider: "google", encryptedClientId, encryptedClientSecret, updatedBy,
  }).onConflictDoUpdate({
    target: oauthCredentialsTable.provider,
    set: { encryptedClientId, encryptedClientSecret, updatedBy, updatedAt: new Date() },
  });
}

export function buildGoogleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  given_name?: string;
  family_name?: string;
}

export async function exchangeGoogleCode(code: string, creds: GoogleCredentials, redirectUri: string): Promise<GoogleUserInfo> {
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const userRes = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!userRes.ok) throw new Error(`Google userinfo fetch failed: ${userRes.status}`);
  return (await userRes.json()) as GoogleUserInfo;
}
