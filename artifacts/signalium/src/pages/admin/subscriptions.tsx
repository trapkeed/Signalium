import { useListSubscriptions, useCancelSubscription, getListSubscriptionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  active: "text-success border-success/30 bg-success/10",
  cancelled: "text-muted-foreground border-border bg-secondary",
  past_due: "text-destructive border-destructive/30 bg-destructive/10",
  trialing: "text-warning border-warning/30 bg-warning/10",
};

export default function AdminSubscriptions() {
  const { data: subscriptions, isLoading } = useListSubscriptions();
  const queryClient = useQueryClient();
  const cancel = useCancelSubscription();

  const handleCancel = (id: number) => {
    if (!confirm("Cancel this subscription?")) return;
    cancel.mutate(
      { id },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() }) }
    );
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-border">
        <h1 className="text-xl font-bold tracking-tight">All Subscriptions</h1>
        <p className="text-xs text-muted-foreground mt-0.5 font-mono">
          {subscriptions?.length ?? 0} total subscriptions
        </p>
      </div>

      <div className="p-8">
        {isLoading ? (
          <div className="border border-border rounded-sm overflow-hidden animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-4 py-4 border-b border-border last:border-0 flex gap-4">
                <div className="h-4 bg-secondary rounded w-32" />
                <div className="h-4 bg-secondary rounded w-24" />
                <div className="h-4 bg-secondary rounded w-20" />
              </div>
            ))}
          </div>
        ) : subscriptions && subscriptions.length > 0 ? (
          <div className="border border-border rounded-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary">
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">User</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Plan</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Started</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Ends</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <tr key={sub.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[180px] truncate">
                      {(sub as any).userEmail ?? sub.userId}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-sm">{sub.plan?.name ?? `Plan #${sub.planId}`}</div>
                      <div className="text-xs font-mono text-muted-foreground">${sub.plan?.priceMonthly}/mo</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-mono border px-2 py-0.5 rounded-sm ${STATUS_COLORS[sub.status] ?? "text-muted-foreground border-border"}`}>
                        {sub.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {new Date(sub.startedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {sub.endsAt ? new Date(sub.endsAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {sub.status === "active" && (
                        <button
                          onClick={() => handleCancel(sub.id)}
                          disabled={cancel.isPending}
                          className="text-xs font-mono text-destructive border border-destructive/30 hover:bg-destructive/10 px-2 py-1 rounded-sm transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="border border-border bg-card rounded-sm p-12 text-center text-muted-foreground">
            <CreditCard className="w-8 h-8 mx-auto mb-3 opacity-30" />
            No subscriptions yet.
          </div>
        )}
      </div>
    </div>
  );
}
