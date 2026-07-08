import { useState } from "react";
import {
  useListSubscriptions,
  useCancelSubscription,
  useSuspendSubscription,
  useReactivateSubscription,
  useExtendSubscription,
  useGrantSubscriptionCredit,
  getListSubscriptionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const STATUS_COLORS: Record<string, string> = {
  active: "text-success border-success/30 bg-success/10",
  grace_period: "text-warning border-warning/30 bg-warning/10",
  pending_payment: "text-warning border-warning/30 bg-warning/10",
  paused: "text-warning border-warning/30 bg-warning/10",
  cancelled: "text-muted-foreground border-border bg-secondary",
  suspended: "text-destructive border-destructive/30 bg-destructive/10",
  expired: "text-destructive border-destructive/30 bg-destructive/10",
};

type ExtendDialog = { id: number; days: string; notes: string };
type CreditDialog = { id: number; days: string; reason: string };

export default function AdminSubscriptions() {
  const { toast } = useToast();
  const { data: subscriptions, isLoading } = useListSubscriptions();
  const queryClient = useQueryClient();

  const cancel = useCancelSubscription();
  const suspend = useSuspendSubscription();
  const reactivate = useReactivateSubscription();
  const extend = useExtendSubscription();
  const credit = useGrantSubscriptionCredit();

  const [extendDialog, setExtendDialog] = useState<ExtendDialog | null>(null);
  const [creditDialog, setCreditDialog] = useState<CreditDialog | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });
  }

  const handleCancel = (id: number) => {
    if (!confirm("Cancel this subscription?")) return;
    cancel.mutate({ id }, { onSuccess: invalidate });
  };

  const handleSuspend = (id: number) => {
    if (!confirm("Suspend this subscription? The user will lose access immediately.")) return;
    suspend.mutate(
      { id },
      {
        onSuccess: () => { toast({ title: "Subscription suspended" }); invalidate(); },
        onError: () => toast({ title: "Failed to suspend", variant: "destructive" }),
      }
    );
  };

  const handleReactivate = (id: number) => {
    reactivate.mutate(
      { id },
      {
        onSuccess: () => { toast({ title: "Subscription reactivated" }); invalidate(); },
        onError: () => toast({ title: "Failed to reactivate", variant: "destructive" }),
      }
    );
  };

  async function handleExtend() {
    if (!extendDialog) return;
    const days = Number(extendDialog.days);
    if (!days || days < 1) {
      toast({ title: "Enter a valid number of days (min 1)", variant: "destructive" });
      return;
    }
    try {
      await extend.mutateAsync({ id: extendDialog.id, data: { days, notes: extendDialog.notes || undefined } });
      toast({ title: `Subscription extended by ${days} day${days === 1 ? "" : "s"}` });
      setExtendDialog(null);
      invalidate();
    } catch {
      toast({ title: "Failed to extend subscription", variant: "destructive" });
    }
  }

  async function handleCredit() {
    if (!creditDialog) return;
    const days = Number(creditDialog.days);
    if (!days || days < 1) {
      toast({ title: "Enter a valid number of days (min 1)", variant: "destructive" });
      return;
    }
    try {
      await credit.mutateAsync({ id: creditDialog.id, data: { days, reason: creditDialog.reason || undefined } });
      toast({ title: `${days} free day${days === 1 ? "" : "s"} credited` });
      setCreditDialog(null);
      invalidate();
    } catch {
      toast({ title: "Failed to grant credit", variant: "destructive" });
    }
  }

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
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Period End</th>
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
                        {sub.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {new Date(sub.startedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {(sub as any).currentPeriodEnd ? new Date((sub as any).currentPeriodEnd).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {/* Extend — any non-cancelled/non-expired sub */}
                        {sub.status !== "cancelled" && sub.status !== "expired" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs rounded-sm px-2 font-mono"
                            onClick={() => setExtendDialog({ id: sub.id, days: "7", notes: "" })}
                          >
                            Extend
                          </Button>
                        )}
                        {/* Credit — active or grace */}
                        {(sub.status === "active" || sub.status === "grace_period") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs rounded-sm px-2 font-mono"
                            onClick={() => setCreditDialog({ id: sub.id, days: "7", reason: "" })}
                          >
                            Credit
                          </Button>
                        )}
                        {/* Suspend — active or grace */}
                        {(sub.status === "active" || sub.status === "grace_period") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs rounded-sm px-2 font-mono text-yellow-500 hover:text-yellow-500"
                            onClick={() => handleSuspend(sub.id)}
                            disabled={suspend.isPending}
                          >
                            Suspend
                          </Button>
                        )}
                        {/* Reactivate — suspended */}
                        {sub.status === "suspended" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs rounded-sm px-2 font-mono text-success border-success/30"
                            onClick={() => handleReactivate(sub.id)}
                            disabled={reactivate.isPending}
                          >
                            Reactivate
                          </Button>
                        )}
                        {/* Cancel — active or grace */}
                        {(sub.status === "active" || sub.status === "grace_period") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs rounded-sm px-2 font-mono text-destructive hover:text-destructive"
                            onClick={() => handleCancel(sub.id)}
                            disabled={cancel.isPending}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
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

      {/* Extend dialog */}
      <Dialog open={!!extendDialog} onOpenChange={() => setExtendDialog(null)}>
        <DialogContent className="bg-card border-border rounded-sm max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono">Extend Subscription #{extendDialog?.id}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Days to add</Label>
              <Input
                type="number"
                min={1}
                value={extendDialog?.days ?? ""}
                onChange={(e) => setExtendDialog((d) => d ? { ...d, days: e.target.value } : d)}
                placeholder="7"
                className="rounded-sm font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Notes (optional)</Label>
              <Input
                value={extendDialog?.notes ?? ""}
                onChange={(e) => setExtendDialog((d) => d ? { ...d, notes: e.target.value } : d)}
                placeholder="e.g. Goodwill — service disruption"
                className="rounded-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendDialog(null)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleExtend} disabled={extend.isPending} className="rounded-sm font-mono">
              {extend.isPending ? "Extending..." : "Extend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credit dialog */}
      <Dialog open={!!creditDialog} onOpenChange={() => setCreditDialog(null)}>
        <DialogContent className="bg-card border-border rounded-sm max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono">Grant Promotional Credit — #{creditDialog?.id}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Free days to grant</Label>
              <Input
                type="number"
                min={1}
                value={creditDialog?.days ?? ""}
                onChange={(e) => setCreditDialog((d) => d ? { ...d, days: e.target.value } : d)}
                placeholder="7"
                className="rounded-sm font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Reason (optional)</Label>
              <Input
                value={creditDialog?.reason ?? ""}
                onChange={(e) => setCreditDialog((d) => d ? { ...d, reason: e.target.value } : d)}
                placeholder="e.g. Referral reward, compensation"
                className="rounded-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Free days are added to the current billing period end. Grace-period or expired subscriptions are reactivated.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditDialog(null)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleCredit} disabled={credit.isPending} className="rounded-sm font-mono">
              {credit.isPending ? "Granting..." : "Grant Credit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
