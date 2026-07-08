import type { PaymentProviderRow } from "@workspace/db";
import type { PaymentProvider } from "./types";
import { createUsdtProvider } from "./usdtProvider";
import { stripeProvider } from "./stripeProvider";
import { paypalProvider } from "./paypalProvider";
import { flutterwaveProvider } from "./flutterwaveProvider";

const registry = new Map<PaymentProviderRow["type"], PaymentProvider>([
  ["usdt_trc20", createUsdtProvider("trc20")],
  ["usdt_erc20", createUsdtProvider("erc20")],
  ["usdt_bep20", createUsdtProvider("bep20")],
  ["stripe", stripeProvider],
  ["paypal", paypalProvider],
  ["flutterwave", flutterwaveProvider],
]);

export function getPaymentProvider(type: PaymentProviderRow["type"]): PaymentProvider | undefined {
  return registry.get(type);
}

export function listPaymentProviderImpls(): PaymentProvider[] {
  return Array.from(registry.values());
}
