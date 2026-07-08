import type { PaymentProvider, PaymentIntentContext, PaymentIntentResult, WebhookVerificationResult } from "./types";

/**
 * USDT payment provider, one instance per network (TRC20/ERC20/BEP20).
 *
 * IMPORTANT LIMITATION (intentional, per task scope): this environment has no
 * blockchain node access or funded third-party monitoring API (e.g.
 * Tatum/BlockCypher), so confirmations are NOT tracked automatically. There
 * is no `verifyWebhook` source of truth for on-chain events — chain
 * confirmations must be recorded by an admin via
 * `POST /payments/:id/confirmations` after checking a block explorer. This
 * is called out explicitly rather than faking confirmation counts.
 *
 * What this provider DOES do for real: generates the correct wallet
 * address + required-confirmation threshold per network from admin config,
 * enforces the PENDING -> CONFIRMING -> CONFIRMED/FAILED/EXPIRED state
 * machine, and expires unpaid intents after a time window.
 */

const NETWORK_DEFAULTS: Record<"trc20" | "erc20" | "bep20", { requiredConfirmations: number; label: string }> = {
  trc20: { requiredConfirmations: 20, label: "USDT (TRC20 - Tron)" },
  erc20: { requiredConfirmations: 12, label: "USDT (ERC20 - Ethereum)" },
  bep20: { requiredConfirmations: 15, label: "USDT (BEP20 - BNB Smart Chain)" },
};

const INTENT_EXPIRY_MINUTES = 45;

export function createUsdtProvider(network: "trc20" | "erc20" | "bep20"): PaymentProvider {
  const defaults = NETWORK_DEFAULTS[network];

  return {
    type: `usdt_${network}` as PaymentProvider["type"],

    isConfigured(config) {
      return !!config.walletAddress && config.walletAddress.trim().length > 0;
    },

    connectivityNote(config) {
      if (!config.walletAddress) {
        return `No receiving wallet address configured for ${defaults.label}. An admin must set one before this network can accept payments.`;
      }
      return null;
    },

    async createIntent(ctx: PaymentIntentContext, config: Record<string, string>): Promise<PaymentIntentResult> {
      if (!this.isConfigured(config)) {
        throw new Error(`${defaults.label} is not configured with a receiving wallet address.`);
      }
      const requiredConfirmations = config.requiredConfirmations
        ? Number(config.requiredConfirmations)
        : defaults.requiredConfirmations;
      const expiresAt = new Date(Date.now() + INTENT_EXPIRY_MINUTES * 60 * 1000);

      return {
        patch: {
          network,
          walletAddress: config.walletAddress,
          requiredConfirmations,
          expiresAt,
        },
        instructions: {
          network: defaults.label,
          walletAddress: config.walletAddress,
          amount: ctx.amount,
          currency: "USDT",
          requiredConfirmations,
          expiresAt: expiresAt.toISOString(),
          memo: config.memo || undefined,
          note: "Send the exact amount shown, then submit your transaction hash. Confirmations are verified manually by an admin against a block explorer — this platform does not run its own blockchain node.",
        },
      };
    },

    async verifyWebhook(): Promise<WebhookVerificationResult> {
      return {
        ok: false,
        reason: `${defaults.label} has no automated webhook source in this environment; confirmations must be recorded by an admin.`,
      };
    },
  };
}
