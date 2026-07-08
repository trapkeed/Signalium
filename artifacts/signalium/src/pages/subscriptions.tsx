import { useState } from "react";
import {
  useListPlans,
  useGetMySubscription,
  useCreateSubscription,
  useCancelSubscription,
  useListSubscriptionEvents,
  getGetMySubscriptionQueryKey,
  getListSubscriptionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, CheckCircle, History, ArrowUp, ArrowDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const TIER_ORDER = { starter: 0, professional: 1, enterprise: 2 };
const TIER_COLORS: Record<string, string> = {
  starter: "border-border",
  professional: "border-primary",
  enterprise: "border-warning/60",
};

const EVENT_LABELS: Record<string, string> = {
  SUBSCRIPTION_CREATED: "Subscription created",
  SUBSCRIPTION_CANCELLED: "Subscription cancelled",
  SUBSCRIPTION_SUSPENDED: "Subscription suspended",
  SUBSCRIPTION_REACTIVATED: "Subscription reactivated",
  SUBSCRIPTION_EXTENDED: "Subscription extended",
  PROMOTIONAL_CREDIT_GRANTED: "Promotional credit granted",
  PAYMENT_CONFIRMED: "Payment confirmed",
  PAYMENT_FAILED: "Payment failed",
  PAYMENT_REFUNDED: "Payment refunded",
  INVOICE_ISSUED: "Invoice issued",
  ADMIN_OVERRIDE: "Admin override",
};

const EVENT_COLORS: Record<string, string> = {
  SUBSCRIPTION_CREATED: "text-success",
  SUBSCRIPTION_CANCELLED: "text-destructive",
  SUBSCRIPTION_SUSPENDED: "text-yellow-500",
  SUBSCRIPTION_REACTIVATED: "text-success",
  SUBSCRIPTION_EXTENDED: "text-blue-400",
  PROMOTIONAL_CREDIT_GRANTED: "text-primary",
  PAYMENT_CONFIRMED: "text-success",
  PAYMENT_FAILED: "text-destructive",
  PAYMENT_REFUNDED: "text-muted-foreground",
  INVOICE_ISSUED: "text-blue-400",
  ADMIN_OVERRIDE: "text-yellow-500",
};

function SubscriptionHistory({ subscriptionId }: { subscriptionId: number }) {
  const { data: events = [], isLoading } = useListSubscriptionEvents(subscriptionId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-secondary/50 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="border border-border rounded-lg p-8 text-center text-muted-foreground text-sm">
        <History className="w-6 h-6 mx-auto mb-2 opacity-40" />
        No subscription history yet.
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/30">
            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Event</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status change</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev: any) => (
            <tr key={ev.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3">
                <span className={`text-xs font-semibold ${EVENT_COLORS[ev.eventType] ?? "text-muted-foreground"}`}>
                  {EVENT_LABELS[ev.eventType] ?? ev.eventType.replace(/_/g, " ")}
                </span>
                {ev.metadata?.days && (
                  <span className="ml-2 text-xs text-muted-foreground font-mono">+{ev.metadata.days}d</span>
                )}
                {ev.metadata?.reason && (
                  <div className="text-xs text-muted-foreground mt-0.5">{ev.metadata.reason}</div>
                )}
                {ev.metadata?.notes && (
                  <div className="text-xs text-muted-foreground mt-0.5">{ev.metadata.notes}</div>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {ev.fromStatus && ev.toStatus ? (
                  <span>{ev.fromStatus.replace(/_/g, " ")} → {ev.toStatus.replace(/_/g, " ")}</span>
                ) : (
                  ev.toStatus ? <span>{ev.toStatus.replace(/_/g, " ")}</span> : "—"
                )}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                {new Date(ev.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Subscriptions({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: plans } = useListPlans();
  const { data: subscription, isLoading } = useGetMySubscription();
  const createSub = useCreateSubscription();
  const cancelSub = useCancelSubscription();

  const [confirmDialog, setConfirmDialog] = useState<{ planId: number; planName: string; action: "upgrade" | "downgrade" | "subscribe" } | null>(null);

  const currentTierOrder = subscription?.plan?.tier
    ? TIER_ORDER[subscription.plan.tier as keyof typeof TIER_ORDER]
    : -1;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getGetMySubscriptionQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });
  }

  const handleSubscribeClick = (planId: number, planName: string, action: "upgrade" | "downgrade" | "subscribe") => {
    setConfirmDialog({ planId, planName, action });
  };

  const handleConfirmSubscribe = () => {
    if (!confirmDialog) return;
    createSub.mutate(
      { data: { planId: confirmDialog.planId } },
      {
        onSuccess: () => {
          toast({ title: `Plan ${confirmDialog.action === "upgrade" ? "upgraded" : confirmDialog.action === "downgrade" ? "changed" : "activated"} successfully` });
          setConfirmDialog(null);
          invalidate();
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "Failed to change plan";
          toast({ title: msg, variant: "destructive" });
          setConfirmDialog(null);
        },
      }
    );
  };

  const handleCancel = () => {
    if (!subscription) return;
    if (!confirm("Are you sure you want to cancel your subscription?")) return;
    cancelSub.mutate(
      { id: subscription.id },
      {
        onSuccess: invalidate,
        onError: () => toast({ title: "Failed to cancel subscription", variant: "destructive" }),
      }
    );
  };

  const planSection = (
    <>
      {/* Current subscription */}
      {!isLoading && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Current Plan</div>
          {subscription ? (
            <div className="border border-primary/30 bg-primary/5 rounded-lg p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-bold text-lg">{subscription.plan?.name}</div>
                  <div className="text-2xl font-bold tabular-nums mt-1">
                    ${subscription.plan?.priceMonthly}
                    <span className="text-sm font-normal text-muted-foreground">/month</span>
                  </div>
                  <div className={`inline-flex items-center gap-1 text-xs font-semibold mt-2 px-2.5 py-1 rounded-full ${
                    subscription.status === "active" ? "bg-success/15 text-success" :
                    subscription.status === "grace_period" || subscription.status === "pending_payment" || subscription.status === "paused" ? "bg-warning/15 text-warning" :
                    "bg-destructive/15 text-destructive"
                  }`}>
                    {subscription.status.replace(/_/g, " ").toUpperCase()}
                  </div>
                  {subscription.status === "grace_period" && (subscription as any).graceEndsAt && (
                    <div className="text-xs text-warning mt-1">
                      Payment past due — access ends {new Date((subscription as any).graceEndsAt).toLocaleDateString()} unless renewed
                    </div>
                  )}
                </div>
                <button
                  onClick={handleCancel}
                  disabled={cancelSub.isPending}
                  className="text-xs text-destructive border border-destructive/30 hover:bg-destructive/10 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  Cancel subscription
                </button>
              </div>
              {subscription.plan?.features && (
                <div className="grid md:grid-cols-2 gap-2 mt-4 pt-4 border-t border-primary/20">
                  {(subscription.plan.features as string[]).map((f: string) => (
                    <div key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle className="w-3.5 h-3.5 text-success flex-shrink-0" />
                      {f}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="border border-border bg-card rounded-lg p-6 text-muted-foreground text-sm flex items-center gap-3">
              <CreditCard className="w-5 h-5 opacity-50" />
              No active subscription. Choose a plan below to get started.
            </div>
          )}
        </div>
      )}

      {/* Plan comparison */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Available Plans</div>
        <div className="grid md:grid-cols-3 gap-4">
          {plans?.map((plan) => {
            const planTierOrder = TIER_ORDER[plan.tier as keyof typeof TIER_ORDER];
            const isCurrent = subscription?.planId === plan.id && (subscription.status === "active" || subscription.status === "grace_period");
            const isUpgrade = planTierOrder > currentTierOrder;
            const isDowngrade = planTierOrder < currentTierOrder && currentTierOrder !== -1;
            const action = isUpgrade ? "upgrade" : isDowngrade ? "downgrade" : "subscribe";

            return (
              <div
                key={plan.id}
                className={`border rounded-lg p-6 flex flex-col gap-4 ${isCurrent ? "border-primary bg-primary/5" : TIER_COLORS[plan.tier] + " bg-card"}`}
              >
                {isCurrent && (
                  <div className="text-xs font-semibold text-primary uppercase tracking-wider">Current plan</div>
                )}
                {plan.tier === "professional" && !isCurrent && (
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Most popular</div>
                )}

                <div>
                  <div className="font-bold text-lg">{plan.name}</div>
                  <div className="text-3xl font-bold tabular-nums mt-1">
                    {plan.promoPriceMonthly != null ? (
                      <>
                        <span className="text-primary">${plan.promoPriceMonthly}</span>
                        <span className="text-base font-normal text-muted-foreground line-through ml-2">${plan.priceMonthly}</span>
                      </>
                    ) : (
                      <>${plan.priceMonthly}</>
                    )}
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </div>
                  {plan.promoPriceMonthly != null && plan.promoLabel && (
                    <div className="text-xs text-primary font-semibold mt-0.5">{plan.promoLabel}</div>
                  )}
                </div>

                <div className="text-sm text-muted-foreground">{plan.description}</div>

                <div className="space-y-2 flex-1">
                  {(plan.features as string[]).map((f: string) => (
                    <div key={f} className="flex items-center gap-2 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                      {f}
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => !isCurrent && handleSubscribeClick(plan.id, plan.name, action)}
                  disabled={isCurrent || createSub.isPending}
                  className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
                    isCurrent
                      ? "bg-secondary text-muted-foreground cursor-default"
                      : plan.tier === "professional"
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "border border-border hover:bg-secondary text-foreground"
                  }`}
                >
                  {isCurrent ? "Current plan" : isUpgrade ? (
                    <><ArrowUp className="w-3.5 h-3.5" /> Upgrade</>
                  ) : isDowngrade ? (
                    <><ArrowDown className="w-3.5 h-3.5" /> Downgrade</>
                  ) : "Subscribe"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );

  const content = (
    <div className={embedded ? "space-y-8 max-w-5xl" : "p-8 space-y-8 max-w-5xl"}>
      {subscription ? (
        <Tabs defaultValue="plan">
          <TabsList className="rounded-lg mb-6 bg-secondary/50 border border-border">
            <TabsTrigger value="plan" className="rounded-lg text-sm">Plan</TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg text-sm flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" /> History
            </TabsTrigger>
          </TabsList>
          <TabsContent value="plan" className="space-y-8">{planSection}</TabsContent>
          <TabsContent value="history">
            <SubscriptionHistory subscriptionId={subscription.id} />
          </TabsContent>
        </Tabs>
      ) : planSection}
    </div>
  );

  return (
    <div className={embedded ? "" : "flex-1 overflow-auto"}>
      {!embedded && (
        <div className="px-8 py-6 border-b border-border">
          <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your Signalium subscription</p>
        </div>
      )}

      {content}

      {/* Upgrade/downgrade confirmation dialog */}
      <Dialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
        <DialogContent className="bg-card border-border rounded-lg max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmDialog?.action === "upgrade" ? "Upgrade to" : confirmDialog?.action === "downgrade" ? "Downgrade to" : "Subscribe to"} {confirmDialog?.planName}?
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-muted-foreground">
            {confirmDialog?.action === "upgrade" && (
              <p>Your plan will be upgraded immediately. You'll need to complete a payment to keep access after the current period ends.</p>
            )}
            {confirmDialog?.action === "downgrade" && (
              <p>Your plan will be changed to {confirmDialog.planName}. Some features available on your current plan may become unavailable.</p>
            )}
            {confirmDialog?.action === "subscribe" && (
              <p>You'll be subscribed to {confirmDialog?.planName}. Complete a payment to activate full access.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)} className="rounded-lg">Cancel</Button>
            <Button onClick={handleConfirmSubscribe} disabled={createSub.isPending} className="rounded-lg">
              {createSub.isPending ? "Confirming..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
