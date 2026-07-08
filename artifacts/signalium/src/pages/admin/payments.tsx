import { useState } from "react";
import { useListAllPayments, useConfirmPayment, useRejectPayment, useListPaymentProviders, useCreatePaymentProvider, useUpdatePaymentProvider, useDeletePaymentProvider } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Clock, AlertCircle, Plus, Trash2, Settings2, Wallet, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STATUS_CONFIG = {
  pending: { label: "Pending", icon: Clock, color: "text-yellow-500" },
  submitted: { label: "Submitted", icon: AlertCircle, color: "text-blue-400" },
  confirmed: { label: "Confirmed", icon: CheckCircle, color: "text-primary" },
  failed: { label: "Failed", icon: XCircle, color: "text-destructive" },
  refunded: { label: "Refunded", icon: Clock, color: "text-muted-foreground" },
};

const PROVIDER_TYPES = ["usdt", "card", "bank_transfer"] as const;
const PROVIDER_LABELS = { usdt: "USDT (Crypto)", card: "Card", bank_transfer: "Bank Transfer" };
const PROVIDER_ICONS = { usdt: Wallet, card: CreditCard, bank_transfer: CreditCard };

type ProviderForm = {
  type: string; name: string; isActive: boolean;
  wallet?: string; network?: string; memo?: string;
  apiKey?: string; webhookSecret?: string;
  bankName?: string; accountNumber?: string; routingNumber?: string;
};

export default function AdminPayments() {
  const { toast } = useToast();
  const [rejectDialogId, setRejectDialogId] = useState<number | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editProviderId, setEditProviderId] = useState<number | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderForm>({
    type: "usdt", name: "", isActive: false,
  });

  const { data: payments = [], refetch: refetchPayments } = useListAllPayments();
  const { data: providers = [], refetch: refetchProviders } = useListPaymentProviders();
  const confirmPayment = useConfirmPayment();
  const rejectPayment = useRejectPayment();
  const createProvider = useCreatePaymentProvider();
  const updateProvider = useUpdatePaymentProvider();
  const deleteProvider = useDeletePaymentProvider();

  async function handleConfirm(id: number) {
    try {
      await confirmPayment.mutateAsync({ id });
      toast({ title: "Payment confirmed — subscription activated" });
      refetchPayments();
    } catch {
      toast({ title: "Failed to confirm payment", variant: "destructive" });
    }
  }

  async function handleReject() {
    if (!rejectDialogId) return;
    try {
      await rejectPayment.mutateAsync({ id: rejectDialogId, data: { notes: rejectNotes || undefined } });
      toast({ title: "Payment rejected" });
      setRejectDialogId(null);
      setRejectNotes("");
      refetchPayments();
    } catch {
      toast({ title: "Failed to reject payment", variant: "destructive" });
    }
  }

  function openProviderCreate() {
    setEditProviderId(null);
    setProviderForm({ type: "usdt", name: "", isActive: false });
    setProviderDialogOpen(true);
  }

  function openProviderEdit(p: typeof providers[0]) {
    const cfg = p.config as Record<string, string>;
    setEditProviderId(p.id);
    setProviderForm({
      type: p.type, name: p.name, isActive: p.isActive,
      wallet: cfg.wallet, network: cfg.network, memo: cfg.memo,
      apiKey: cfg.apiKey, webhookSecret: cfg.webhookSecret,
      bankName: cfg.bankName, accountNumber: cfg.accountNumber, routingNumber: cfg.routingNumber,
    });
    setProviderDialogOpen(true);
  }

  async function handleSaveProvider() {
    const config: Record<string, string> = {};
    if (providerForm.wallet) config.wallet = providerForm.wallet;
    if (providerForm.network) config.network = providerForm.network;
    if (providerForm.memo) config.memo = providerForm.memo;
    if (providerForm.apiKey) config.apiKey = providerForm.apiKey;
    if (providerForm.webhookSecret) config.webhookSecret = providerForm.webhookSecret;
    if (providerForm.bankName) config.bankName = providerForm.bankName;
    if (providerForm.accountNumber) config.accountNumber = providerForm.accountNumber;
    if (providerForm.routingNumber) config.routingNumber = providerForm.routingNumber;

    try {
      if (editProviderId) {
        await updateProvider.mutateAsync({
          id: editProviderId,
          data: { name: providerForm.name, isActive: providerForm.isActive, config },
        });
        toast({ title: "Provider updated" });
      } else {
        await createProvider.mutateAsync({
          data: { type: providerForm.type as any, name: providerForm.name, isActive: providerForm.isActive, config },
        });
        toast({ title: "Provider created" });
      }
      setProviderDialogOpen(false);
      refetchProviders();
    } catch {
      toast({ title: "Failed to save provider", variant: "destructive" });
    }
  }

  async function handleDeleteProvider(id: number) {
    try {
      await deleteProvider.mutateAsync({ id });
      toast({ title: "Provider deleted" });
      refetchProviders();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  }

  const pendingPayments = payments.filter((p) => p.status === "submitted");
  const allPayments = payments;

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight">Payment Management</h1>
        <p className="text-sm text-muted-foreground mt-1">Review payments, manage providers</p>
      </div>

      <div className="flex-1 p-8 max-w-5xl">
        <Tabs defaultValue="payments">
          <TabsList className="rounded-sm mb-6 bg-secondary/50 border border-border">
            <TabsTrigger value="payments" className="rounded-sm font-mono text-xs">
              Payments {pendingPayments.length > 0 && <span className="ml-2 bg-primary text-primary-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center">{pendingPayments.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="providers" className="rounded-sm font-mono text-xs">Providers</TabsTrigger>
          </TabsList>

          {/* Payments tab */}
          <TabsContent value="payments">
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["ID", "User", "Amount", "Reference", "TX Hash", "Status", "Date", "Actions"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allPayments.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">No payments yet</td></tr>
                  ) : (
                    allPayments.map((p) => {
                      const cfg = STATUS_CONFIG[p.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
                      const Icon = cfg.icon;
                      return (
                        <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{p.id}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[120px] truncate">{p.userId}</td>
                          <td className="px-4 py-3 font-mono font-bold">${p.amount}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.reference ?? "—"}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[100px] truncate">{p.txHash ?? "—"}</td>
                          <td className="px-4 py-3">
                            <span className={`flex items-center gap-1.5 text-xs font-mono ${cfg.color}`}>
                              <Icon className="w-3.5 h-3.5" /> {cfg.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                            {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {(p.status === "pending" || p.status === "submitted") && (
                              <div className="flex gap-1">
                                <Button size="sm" className="h-7 text-xs rounded-sm px-2 font-mono" onClick={() => handleConfirm(p.id)}>
                                  Confirm
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs rounded-sm px-2 text-destructive hover:text-destructive" onClick={() => { setRejectDialogId(p.id); setRejectNotes(""); }}>
                                  Reject
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Providers tab */}
          <TabsContent value="providers">
            <div className="flex justify-end mb-4">
              <Button onClick={openProviderCreate} className="gap-2 font-mono text-xs rounded-sm">
                <Plus className="w-4 h-4" /> Add Provider
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              {providers.map((p) => {
                const Icon = PROVIDER_ICONS[p.type as keyof typeof PROVIDER_ICONS] ?? Wallet;
                const cfg = p.config as Record<string, string>;
                return (
                  <div key={p.id} className="border border-border rounded-sm bg-card p-5 flex items-center gap-4">
                    <div className="w-9 h-9 rounded-sm bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs font-mono text-muted-foreground">{PROVIDER_LABELS[p.type as keyof typeof PROVIDER_LABELS] ?? p.type}</span>
                        {p.isActive && <span className="text-xs font-mono text-primary border border-primary/30 px-1.5 py-0.5 rounded-sm">active</span>}
                      </div>
                      {cfg.wallet && <div className="text-xs text-muted-foreground font-mono">Wallet: {cfg.wallet.slice(0, 20)}...</div>}
                      {cfg.network && <div className="text-xs text-muted-foreground">Network: {cfg.network}</div>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="outline" size="sm" className="rounded-sm text-xs gap-1" onClick={() => openProviderEdit(p)}>
                        <Settings2 className="w-3.5 h-3.5" /> Configure
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-8 w-8 p-0 rounded-sm" onClick={() => handleDeleteProvider(p.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {providers.length === 0 && (
                <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-xs">
                  No payment providers configured.
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Reject dialog */}
      <Dialog open={!!rejectDialogId} onOpenChange={() => setRejectDialogId(null)}>
        <DialogContent className="bg-card border-border rounded-sm max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono">Reject Payment #{rejectDialogId}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Reason (optional)</Label>
            <Input value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} placeholder="e.g. Invalid transaction hash" className="rounded-sm" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogId(null)} className="rounded-sm">Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={rejectPayment.isPending} className="rounded-sm font-mono">
              {rejectPayment.isPending ? "Rejecting..." : "Reject Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Provider dialog */}
      <Dialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen}>
        <DialogContent className="bg-card border-border rounded-sm max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono">{editProviderId ? "Edit Provider" : "New Payment Provider"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2 max-h-[70vh] overflow-y-auto">
            {!editProviderId && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Type</Label>
                <select
                  value={providerForm.type}
                  onChange={(e) => setProviderForm((f) => ({ ...f, type: e.target.value }))}
                  className="bg-input border border-border rounded-sm px-3 py-2 text-sm font-mono"
                >
                  {PROVIDER_TYPES.map((t) => <option key={t} value={t}>{PROVIDER_LABELS[t]}</option>)}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Display Name</Label>
              <Input value={providerForm.name} onChange={(e) => setProviderForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. USDT TRC-20" className="rounded-sm font-mono text-sm" />
            </div>

            {/* USDT fields */}
            {providerForm.type === "usdt" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Wallet Address</Label>
                  <Input value={providerForm.wallet ?? ""} onChange={(e) => setProviderForm((f) => ({ ...f, wallet: e.target.value }))} placeholder="T... or 0x..." className="rounded-sm font-mono text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Network</Label>
                  <Input value={providerForm.network ?? ""} onChange={(e) => setProviderForm((f) => ({ ...f, network: e.target.value }))} placeholder="e.g. TRC-20" className="rounded-sm font-mono text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Memo Instructions</Label>
                  <Input value={providerForm.memo ?? ""} onChange={(e) => setProviderForm((f) => ({ ...f, memo: e.target.value }))} placeholder="e.g. Include reference number as memo" className="rounded-sm text-sm" />
                </div>
              </>
            )}

            {/* Card fields */}
            {providerForm.type === "card" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">API Key</Label>
                  <Input type="password" value={providerForm.apiKey ?? ""} onChange={(e) => setProviderForm((f) => ({ ...f, apiKey: e.target.value }))} placeholder="sk_..." className="rounded-sm font-mono text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Webhook Secret</Label>
                  <Input type="password" value={providerForm.webhookSecret ?? ""} onChange={(e) => setProviderForm((f) => ({ ...f, webhookSecret: e.target.value }))} placeholder="whsec_..." className="rounded-sm font-mono text-sm" />
                </div>
              </>
            )}

            {/* Bank transfer fields */}
            {providerForm.type === "bank_transfer" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Bank Name</Label>
                  <Input value={providerForm.bankName ?? ""} onChange={(e) => setProviderForm((f) => ({ ...f, bankName: e.target.value }))} className="rounded-sm font-mono text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Account Number</Label>
                  <Input value={providerForm.accountNumber ?? ""} onChange={(e) => setProviderForm((f) => ({ ...f, accountNumber: e.target.value }))} className="rounded-sm font-mono text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Routing Number</Label>
                  <Input value={providerForm.routingNumber ?? ""} onChange={(e) => setProviderForm((f) => ({ ...f, routingNumber: e.target.value }))} className="rounded-sm font-mono text-sm" />
                </div>
              </>
            )}

            <div className="flex items-center gap-3">
              <Switch checked={providerForm.isActive} onCheckedChange={(v) => setProviderForm((f) => ({ ...f, isActive: v }))} />
              <Label className="text-sm">Active (visible to users)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProviderDialogOpen(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleSaveProvider} disabled={!providerForm.name || createProvider.isPending || updateProvider.isPending} className="rounded-sm font-mono">
              {(createProvider.isPending || updateProvider.isPending) ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
