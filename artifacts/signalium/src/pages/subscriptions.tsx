import { useListPlans, useGetMySubscription, useCreateSubscription, useCancelSubscription, getGetMySubscriptionQueryKey, getListSubscriptionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, CheckCircle } from "lucide-react";

const TIER_ORDER = { starter: 0, professional: 1, enterprise: 2 };
const TIER_COLORS: Record<string, string> = {
  starter: "border-border",
  professional: "border-primary",
  enterprise: "border-warning/60",
};

export default function Subscriptions({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { data: plans } = useListPlans();
  const { data: subscription, isLoading } = useGetMySubscription();
  const createSub = useCreateSubscription();
  const cancelSub = useCancelSubscription();

  const currentTierOrder = subscription?.plan?.tier
    ? TIER_ORDER[subscription.plan.tier as keyof typeof TIER_ORDER]
    : -1;

  const handleSubscribe = (planId: number) => {
    createSub.mutate(
      { data: { planId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMySubscriptionQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });
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
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMySubscriptionQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });
        },
      }
    );
  };

  return (
    <div className={embedded ? "" : "flex-1 overflow-auto"}>
      {!embedded && (
        <div className="px-8 py-6 border-b border-border">
          <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your Signalium subscription</p>
        </div>
      )}

      <div className={embedded ? "space-y-8 max-w-5xl" : "p-8 space-y-8 max-w-5xl"}>
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
                    {subscription.status === "grace_period" && subscription.graceEndsAt && (
                      <div className="text-xs text-warning mt-1">
                        Payment past due — access ends {new Date(subscription.graceEndsAt).toLocaleDateString()} unless renewed
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
                      ${plan.priceMonthly}
                      <span className="text-sm font-normal text-muted-foreground">/mo</span>
                    </div>
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
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={isCurrent || createSub.isPending}
                    className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isCurrent
                        ? "bg-secondary text-muted-foreground cursor-default"
                        : plan.tier === "professional"
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "border border-border hover:bg-secondary text-foreground"
                    }`}
                  >
                    {isCurrent ? "Current plan" : isUpgrade ? "Upgrade" : isDowngrade ? "Downgrade" : "Subscribe"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
