import { resolveManagedConfig } from "../secretsVault";

/**
 * Maps a payment provider type to the admin-managed secret keys it needs,
 * each paired with the legacy env var it should fall back to if no vault
 * value has been set yet. Vault values (set via the admin Managed Secrets
 * panel) always win over env vars when both are present.
 */
const PROVIDER_SECRET_KEYS: Record<string, Array<{ managedKey: string; envVar: string; configField: string }>> = {
  stripe: [
    { managedKey: "payments.stripe_secret_key", envVar: "STRIPE_SECRET_KEY", configField: "STRIPE_SECRET_KEY" },
    { managedKey: "payments.stripe_webhook_secret", envVar: "STRIPE_WEBHOOK_SECRET", configField: "STRIPE_WEBHOOK_SECRET" },
  ],
  paypal: [
    { managedKey: "payments.paypal_client_id", envVar: "PAYPAL_CLIENT_ID", configField: "PAYPAL_CLIENT_ID" },
    { managedKey: "payments.paypal_client_secret", envVar: "PAYPAL_CLIENT_SECRET", configField: "PAYPAL_CLIENT_SECRET" },
    { managedKey: "payments.paypal_webhook_id", envVar: "PAYPAL_WEBHOOK_ID", configField: "PAYPAL_WEBHOOK_ID" },
  ],
};

/**
 * Builds the config object passed into a `PaymentProvider`'s methods by
 * layering, from lowest to highest priority: the provider row's stored
 * `config` JSON (non-secret settings), then the admin-managed encrypted
 * vault, then env var fallback (handled inside `resolveManagedConfig`).
 */
export async function resolveProviderConfig(
  type: string,
  storedConfig: Record<string, string> | null | undefined,
): Promise<Record<string, string>> {
  const merged: Record<string, string> = { ...(storedConfig ?? {}) };
  const secretKeys = PROVIDER_SECRET_KEYS[type];
  if (!secretKeys) return merged;

  await Promise.all(
    secretKeys.map(async ({ managedKey, envVar, configField }) => {
      const value = await resolveManagedConfig(managedKey, envVar);
      if (value) merged[configField] = value;
    }),
  );
  return merged;
}
