import { useState } from "react";
import { useListMyPayments, useListPlans, useListPaymentProviders, useCreatePaymentIntent, useSubmitPaymentProof } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Wallet, CreditCard, ArrowRight, CheckCircle, Clock, XCircle, AlertCircle, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

const STATUS_CONFIG = {
  pending: { label: "Pending", icon: Clock, color: "text-yellow-500" },
  submitted: { label: "Submitted", icon: AlertCircle, color: "text-blue-400" },
  confirmed: { label: "Confirmed", icon: CheckCircle, color: "text-primary" },
  failed: { label: "Failed", icon: XCircle, color: "text-destructive" },
  refunded: { label: "Refunded", icon: ArrowRight, color: "text-muted-foreground" },
};

const PROVIDER_ICONS = {
  usdt: Wallet,
  card: CreditCard,
  bank_transfer: ArrowRight,
};

const TIER_LABELS = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

type PaymentIntent = {
  payment: {
    id: number;
    reference?: string | null;
    amount: number;
    currency: string;
  };
  provider: {
    type: string;
    name: string;
    instructions?: Record<string, string> | null;
  };
};

export default function Payments() {
  const { toast } = useToast();
  const [step, setStep] = useState<"list" | "choose-plan" | "choose-provider" | "submit-proof">("list");
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<number | null>(null);
  const [activeIntent, setActiveIntent] = useState<PaymentIntent | null>(null);
  const [txHash, setTxHash] = useState("");

  const { data: payments = [], refetch } = useListMyPayments();
  const { data: plans = [] } = useListPlans();
  const { data: providers = [] } = useListPaymentProviders();
  const createIntent = useCreatePaymentIntent();
  const submitProof = useSubmitPaymentProof();

  const activePlans = plans.filter((p) => p.isActive);
  const activeProviders = providers.filter((p) => p.isActive);

  async function handleCreateIntent() {
    if (!selectedPlan || !selectedProvider) return;
    try {
      const result = await createIntent.mutateAsync({
        data: { planId: selectedPlan, providerId: selectedProvider },
      });
      setActiveIntent(result as PaymentIntent);
      setStep("submit-proof");
      refetch();
    } catch {
      toast({ title: "Failed to create payment", variant: "destructive" });
    }
  }

  async function handleSubmitProof() {
    if (!activeIntent) return;
    try {
      await submitProof.mutateAsync({
        id: activeIntent.payment.id,
        data: { txHash: txHash || undefined },
      });
      toast({ title: "Payment proof submitted — pending admin confirmation" });
      setStep("list");
      setActiveIntent(null);
      setTxHash("");
      refetch();
    } catch {
      toast({ title: "Failed to submit proof", variant: "destructive" });
    }
  }

  function copyRef(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  }

  if (step === "choose-plan") {
    return (
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="border-b border-border px-8 py-6">
          <button onClick={() => setStep("list")} className="text-xs text-muted-foreground hover:text-foreground mb-3">← Back</button>
          <h1 className="text-2xl font-bold tracking-tight">Choose Plan</h1>
        </div>
        <div className="p-8 max-w-3xl grid grid-cols-1 sm:grid-cols-3 gap-4">
          {activePlans.map((plan) => (
            <button
              key={plan.id}
              onClick={() => { setSelectedPlan(plan.id); setStep("choose-provider"); }}
              className={`border rounded-lg p-5 text-left transition-all hover:border-primary/50 ${selectedPlan === plan.id ? "border-primary bg-primary/5" : "border-border bg-card"}`}
            >
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{TIER_LABELS[plan.tier]}</div>
              <div className="text-2xl font-bold tabular-nums mb-1">${plan.priceMonthly}<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
              <div className="text-sm text-muted-foreground">{plan.name}</div>
              {plan.features && (plan.features as string[]).length > 0 && (
                <ul className="mt-3 space-y-1">
                  {(plan.features as string[]).slice(0, 4).map((f, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <CheckCircle className="w-3 h-3 text-primary shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (step === "choose-provider") {
    return (
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="border-b border-border px-8 py-6">
          <button onClick={() => setStep("choose-plan")} className="text-xs text-muted-foreground hover:text-foreground mb-3">← Back</button>
          <h1 className="text-2xl font-bold tracking-tight">Choose Payment Method</h1>
        </div>
        <div className="p-8 max-w-xl flex flex-col gap-4">
          {activeProviders.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No payment methods available. Please contact support.
            </div>
          ) : (
            activeProviders.map((provider) => {
              const Icon = PROVIDER_ICONS[provider.type as keyof typeof PROVIDER_ICONS] ?? Wallet;
              return (
                <button
                  key={provider.id}
                  onClick={() => { setSelectedProvider(provider.id); handleCreateIntent(); }}
                  className="border border-border rounded-lg p-5 text-left transition-all hover:border-primary/50 hover:bg-primary/5 bg-card flex items-center gap-4"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-medium">{provider.name}</div>
                    <div className="text-xs text-muted-foreground capitalize">{provider.type.replace("_", " ")}</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto" />
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }

  if (step === "submit-proof" && activeIntent) {
    const isUSDT = activeIntent.provider.type === "usdt";
    const wallet = activeIntent.provider.instructions?.wallet;
    const network = activeIntent.provider.instructions?.network;
    const memo = activeIntent.provider.instructions?.memo;

    return (
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="border-b border-border px-8 py-6">
          <button onClick={() => setStep("list")} className="text-xs text-muted-foreground hover:text-foreground mb-3">← Back</button>
          <h1 className="text-2xl font-bold tracking-tight">Complete Payment</h1>
        </div>
        <div className="p-8 max-w-xl flex flex-col gap-5">
          {/* Reference */}
          <div className="border border-border rounded-lg p-4 bg-card flex flex-col gap-1">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reference</div>
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm text-primary">{activeIntent.payment.reference}</code>
              <button onClick={() => copyRef(activeIntent.payment.reference ?? "")} className="text-muted-foreground hover:text-foreground">
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Amount */}
          <div className="border border-border rounded-lg p-4 bg-card">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Amount Due</div>
            <div className="text-2xl font-bold tabular-nums">
              {isUSDT ? `${activeIntent.payment.amount} USDT` : `$${activeIntent.payment.amount}`}
            </div>
          </div>

          {/* Instructions */}
          {isUSDT && wallet && (
            <div className="border border-border rounded-lg p-4 bg-card flex flex-col gap-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment Instructions</div>
              <ol className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><span className="text-primary font-mono text-xs mt-0.5">1.</span> Send exactly <strong className="text-foreground font-mono">{activeIntent.payment.amount} USDT</strong> to:</li>
              </ol>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs bg-secondary border border-border rounded-lg px-3 py-2 text-primary break-all">{wallet}</code>
                <button onClick={() => copyRef(wallet)} className="text-muted-foreground hover:text-foreground shrink-0">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              {network && <div className="text-xs text-muted-foreground">Network: <span className="font-mono text-foreground">{network}</span></div>}
              {memo && <div className="text-xs text-muted-foreground">⚠️ Include your reference as memo/tag: <span className="font-mono text-foreground">{activeIntent.payment.reference}</span></div>}
            </div>
          )}

          {/* TX hash input */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Transaction Hash <span className="normal-case">(optional but speeds up confirmation)</span>
            </Label>
            <Input
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              placeholder={isUSDT ? "0x... or TXID" : "Reference number"}
              className="rounded-lg font-mono text-sm"
            />
          </div>

          <Button onClick={handleSubmitProof} disabled={submitProof.isPending} className="rounded-lg">
            {submitProof.isPending ? "Submitting..." : "Submit Payment Proof"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Your subscription will be activated after admin confirmation, typically within 1–24 hours.
          </p>
        </div>
      </div>
    );
  }

  // Default: payment history
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
          <p className="text-sm text-muted-foreground mt-1">Payment history and new payments</p>
        </div>
        <Button onClick={() => setStep("choose-plan")} className="gap-2 text-sm rounded-lg">
          <Plus className="w-4 h-4" />
          New Payment
        </Button>
      </div>

      <div className="p-8 max-w-4xl">
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reference</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    No payments yet. Start your subscription to get access.
                  </td>
                </tr>
              ) : (
                payments.map((p) => {
                  const cfg = STATUS_CONFIG[p.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
                  const Icon = cfg.icon;
                  return (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.reference ?? `#${p.id}`}</td>
                      <td className="px-4 py-3 font-bold tabular-nums">${p.amount}</td>
                      <td className="px-4 py-3">
                        <span className={`flex items-center gap-1.5 text-xs font-semibold ${cfg.color}`}>
                          <Icon className="w-3.5 h-3.5" /> {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Plus({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
