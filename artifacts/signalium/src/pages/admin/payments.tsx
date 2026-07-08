import { useState } from "react";
import {
  useListAllPayments,
  useConfirmPayment,
  useRejectPayment,
  useReportPaymentConfirmations,
  useRefundPayment,
  useListPaymentProvidersAdmin,
  useCreatePaymentProvider,
  useUpdatePaymentProvider,
  useDeletePaymentProvider,
  useListAllInvoices,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Clock, AlertCircle, Plus, Trash2, Settings2, Wallet, CreditCard, FileText, Download, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STATUS_CONFIG = {
  pending: { label: "Pending", icon: Clock, color: "text-yellow-500" },
  confirming: { label: "Confirming", icon: AlertCircle, color: "text-blue-400" },
  confirmed: { label: "Confirmed", icon: CheckCircle, color: "text-primary" },
  failed: { label: "Failed", icon: XCircle, color: "text-destructive" },
  expired: { label: "Expired", icon: XCircle, color: "text-muted-foreground" },
  refunded: { label: "Refunded", icon: RotateCcw, color: "text-muted-foreground" },
};

const PROVIDER_TYPES = ["usdt_trc20", "usdt_erc20", "usdt_bep20", "stripe", "paypal", "flutterwave"] as const;
const PROVIDER_LABELS: Record<string, string> = {
  usdt_trc20: "USDT (TRC-20)",
  usdt_erc20: "USDT (ERC-20)",
  usdt_bep20: "USDT (BEP-20)",
  stripe: "Stripe",
  paypal: "PayPal",
  flutterwave: "Flutterwave",
};
const PROVIDER_ICONS: Record<string, typeof Wallet> = {
  usdt_trc20: Wallet, usdt_erc20: Wallet, usdt_bep20: Wallet,
  stripe: CreditCard, paypal: CreditCard, flutterwave: CreditCard,
};
const isUsdt = (type: string) => type.startsWith("usdt_");

type ProviderForm = {
  type: string; name: string; isActive: boolean;
  walletAddress?: string; memo?: string; requiredConfirmations?: string;
};

const INVOICE_STATUS_COLOR: Record<string, string> = {
  draft: "text-muted-foreground",
  issued: "text-blue-400",
  paid: "text-primary",
  void: "text-destructive",
};

export default function AdminPayments() {
  const { toast } = useToast();
  const [rejectDialogId, setRejectDialogId] = useState<number | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [confirmationsDialogId, setConfirmationsDialogId] = useState<number | null>(null);
  const [confirmationsValue, setConfirmationsValue] = useState("");
  const [refundDialogId, setRefundDialogId] = useState<number | null>(null);
  const [refundNotes, setRefundNotes] = useState("");
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editProviderId, setEditProviderId] = useState<number | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderForm>({
    type: "usdt_trc20", name: "", isActive: false,
  });

  const { data: payments = [], refetch: refetchPayments } = useListAllPayments();
  const { data: providers = [], refetch: refetchProviders } = useListPaymentProvidersAdmin();
  const { data: invoices = [] } = useListAllInvoices();
  const confirmPayment = useConfirmPayment();
  const rejectPayment = useRejectPayment();
  const reportConfirmations = useReportPaymentConfirmations();
  const refundPayment = useRefundPayment();
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

  async function handleReportConfirmations() {
    if (!confirmationsDialogId) return;
    const n = Number(confirmationsValue);
    if (isNaN(n) || n < 0) {
      toast({ title: "Enter a valid confirmation count", variant: "destructive" });
      return;
    }
    try {
      await reportConfirmations.mutateAsync({ id: confirmationsDialogId, data: { confirmations: n } });
      toast({ title: "Confirmations updated" });
      setConfirmationsDialogId(null);
      setConfirmationsValue("");
      refetchPayments();
    } catch {
      toast({ title: "Failed to update confirmations", variant: "destructive" });
    }
  }

  async function handleRefund() {
    if (!refundDialogId) return;
    try {
      await refundPayment.mutateAsync({ id: refundDialogId, data: { notes: refundNotes || undefined } });
      toast({ title: "Payment refunded" });
      setRefundDialogId(null);
      setRefundNotes("");
      refetchPayments();
    } catch {
      toast({ title: "Failed to refund payment", variant: "destructive" });
    }
  }

  function openProviderCreate() {
    setEditProviderId(null);
    setProviderForm({ type: "usdt_trc20", name: "", isActive: false });
    setProviderDialogOpen(true);
  }

  function openProviderEdit(p: (typeof providers)[0]) {
    const cfg = (p.config ?? {}) as Record<string, string>;
    setEditProviderId(p.id);
    setProviderForm({
      type: p.type, name: p.name, isActive: p.isActive,
      walletAddress: cfg.walletAddress, memo: cfg.memo, requiredConfirmations: cfg.requiredConfirmations,
    });
    setProviderDialogOpen(true);
  }

  async function handleSaveProvider() {
    const config: Record<string, string> = {};
    if (providerForm.walletAddress) config.walletAddress = providerForm.walletAddress;
    if (providerForm.memo) config.memo = providerForm.memo;
    if (providerForm.requiredConfirmations) config.requiredConfirmations = providerForm.requiredConfirmations;

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

  async function handleDownloadInvoice(id: number) {
    try {
      const res = await fetch(
        `${(import.meta as any).env?.BASE_URL ?? "/"}api/invoices/${id}/pdf`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Failed to download invoice", variant: "destructive" });
    }
  }

  const pendingPayments = payments.filter((p) => p.status === "pending" || p.status === "confirming");

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight">Payment Management</h1>
        <p className="text-sm text-muted-foreground mt-1">Review payments, manage providers, browse invoices</p>
      </div>

      <div className="flex-1 p-8 max-w-5xl">
        <Tabs defaultValue="payments">
          <TabsList className="rounded-sm mb-6 bg-secondary/50 border border-border">
            <TabsTrigger value="payments" className="rounded-sm font-mono text-xs">
              Payments {pendingPayments.length > 0 && <span className="ml-2 bg-primary text-primary-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center">{pendingPayments.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="providers" className="rounded-sm font-mono text-xs">Providers</TabsTrigger>
            <TabsTrigger value="invoices" className="rounded-sm font-mono text-xs">Invoices</TabsTrigger>
          </TabsList>

          {/* Payments tab */}
          <TabsContent value="payments">
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["ID", "User", "Amount", "Network", "TX Hash", "Conf.", "Status", "Date", "Actions"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">No payments yet</td></tr>
                  ) : (
                    payments.map((p) => {
                      const cfg = STATUS_CONFIG[p.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
                      const Icon = cfg.icon;
                      return (
                        <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{p.id}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[120px] truncate">{p.userId}</td>
                          <td className="px-4 py-3 font-mono font-bold">${p.amount}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground uppercase">{p.network ?? "—"}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[100px] truncate">{p.txHash ?? "—"}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            {p.network ? `${p.confirmations ?? 0}${p.requiredConfirmations ? ` / ${p.requiredConfirmations}` : ""}` : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`flex items-center gap-1.5 text-xs font-mono ${cfg.color}`}>
                              <Icon className="w-3.5 h-3.5" /> {cfg.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                            {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1 flex-wrap">
                              {(p.status === "pending" || p.status === "confirming") && (
                                <>
                                  {p.network && (
                                    <Button size="sm" variant="outline" className="h-7 text-xs rounded-sm px-2 font-mono"
                                      onClick={() => { setConfirmationsDialogId(p.id); setConfirmationsValue(String(p.confirmations ?? 0)); }}>
                                      Confs
                                    </Button>
                                  )}
                                  <Button size="sm" className="h-7 text-xs rounded-sm px-2 font-mono" onClick={() => handleConfirm(p.id)}>
                                    Confirm
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 text-xs rounded-sm px-2 text-destructive hover:text-destructive"
                                    onClick={() => { setRejectDialogId(p.id); setRejectNotes(""); }}>
                                    Reject
                                  </Button>
                                </>
                              )}
                              {p.status === "confirmed" && (
                                <Button size="sm" variant="ghost"
                                  className="h-7 text-xs rounded-sm px-2 font-mono text-muted-foreground hover:text-foreground"
                                  onClick={() => { setRefundDialogId(p.id); setRefundNotes(""); }}>
                                  <RotateCcw className="w-3 h-3 mr-1" /> Refund
                                </Button>
                              )}
                            </div>
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
                const Icon = PROVIDER_ICONS[p.type] ?? Wallet;
                const cfg = (p.config ?? {}) as Record<string, string>;
                return (
                  <div key={p.id} className="border border-border rounded-sm bg-card p-5 flex items-center gap-4">
                    <div className="w-9 h-9 rounded-sm bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs font-mono text-muted-foreground">{PROVIDER_LABELS[p.type] ?? p.type}</span>
                        {p.isActive && <span className="text-xs font-mono text-primary border border-primary/30 px-1.5 py-0.5 rounded-sm">active</span>}
                        {p.connectable ? (
                          <span className="text-xs font-mono text-primary border border-primary/30 px-1.5 py-0.5 rounded-sm">connectable</span>
                        ) : (
                          <span className="text-xs font-mono text-yellow-500 border border-yellow-500/30 px-1.5 py-0.5 rounded-sm flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> not connectable
                          </span>
                        )}
                      </div>
                      {p.limitation && <div className="text-xs text-yellow-500/90 mb-1">{p.limitation}</div>}
                      {cfg.walletAddress && <div className="text-xs text-muted-foreground font-mono">Wallet: {cfg.walletAddress.slice(0, 20)}...</div>}
                      {isUsdt(p.type) && cfg.requiredConfirmations && <div className="text-xs text-muted-foreground">Required confirmations: {cfg.requiredConfirmations}</div>}
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

          {/* Invoices tab */}
          <TabsContent value="invoices">
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["Invoice #", "User", "Reason", "Amount", "Provider", "Status", "Issued", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">No invoices yet</td></tr>
                  ) : (
                    invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono text-xs flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-muted-foreground" /> {inv.invoiceNumber}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[120px] truncate">{inv.userId}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inv.reason.replace(/_/g, " ")}</td>
                        <td className="px-4 py-3 font-mono font-bold">${inv.amount} {inv.currency}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inv.provider ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-mono ${INVOICE_STATUS_COLOR[inv.status] ?? "text-muted-foreground"}`}>{inv.status}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                          {inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Button size="sm" variant="outline" className="h-7 text-xs rounded-sm px-2 gap-1 font-mono" onClick={() => handleDownloadInvoice(inv.id)}>
                            <Download className="w-3.5 h-3.5" /> PDF
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Reject dialog */}
      <Dialog open={!!rejectDialogId} onOpenChange={() => setRejectDialogId(null)}>
        <DialogContent className="bg-card border-border rounded-sm max-w-sm">
          <DialogHeader><DialogTitle className="font-mono">Reject Payment #{rejectDialogId}</DialogTitle></DialogHeader>
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

      {/* Confirmations dialog */}
      <Dialog open={!!confirmationsDialogId} onOpenChange={() => setConfirmationsDialogId(null)}>
        <DialogContent className="bg-card border-border rounded-sm max-w-sm">
          <DialogHeader><DialogTitle className="font-mono">Report Confirmations — Payment #{confirmationsDialogId}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">On-chain confirmations observed</Label>
            <Input type="number" min={0} value={confirmationsValue} onChange={(e) => setConfirmationsValue(e.target.value)} placeholder="0" className="rounded-sm font-mono" />
            <p className="text-xs text-muted-foreground">Check the relevant block explorer and report the count here. Reaching the required threshold auto-confirms the payment.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmationsDialogId(null)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleReportConfirmations} disabled={reportConfirmations.isPending} className="rounded-sm font-mono">
              {reportConfirmations.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund dialog */}
      <Dialog open={!!refundDialogId} onOpenChange={() => setRefundDialogId(null)}>
        <DialogContent className="bg-card border-border rounded-sm max-w-sm">
          <DialogHeader><DialogTitle className="font-mono">Refund Payment #{refundDialogId}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Notes (optional)</Label>
            <Input value={refundNotes} onChange={(e) => setRefundNotes(e.target.value)} placeholder="e.g. User requested refund within 7 days" className="rounded-sm" />
            <p className="text-xs text-muted-foreground">
              This marks the payment as refunded and logs the event. The user's subscription status is <strong>not</strong> automatically modified — use the Subscriptions panel to cancel or suspend access separately.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundDialogId(null)} className="rounded-sm">Cancel</Button>
            <Button variant="destructive" onClick={handleRefund} disabled={refundPayment.isPending} className="rounded-sm font-mono">
              {refundPayment.isPending ? "Refunding..." : "Mark as Refunded"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Provider dialog */}
      <Dialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen}>
        <DialogContent className="bg-card border-border rounded-sm max-w-lg">
          <DialogHeader><DialogTitle className="font-mono">{editProviderId ? "Edit Provider" : "New Payment Provider"}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4 py-2 max-h-[70vh] overflow-y-auto">
            {!editProviderId && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Type</Label>
                <select value={providerForm.type} onChange={(e) => setProviderForm((f) => ({ ...f, type: e.target.value }))}
                  className="bg-input border border-border rounded-sm px-3 py-2 text-sm font-mono">
                  {PROVIDER_TYPES.map((t) => <option key={t} value={t}>{PROVIDER_LABELS[t]}</option>)}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Display Name</Label>
              <Input value={providerForm.name} onChange={(e) => setProviderForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. USDT TRC-20" className="rounded-sm font-mono text-sm" />
            </div>
            {isUsdt(providerForm.type) && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Wallet Address</Label>
                  <Input value={providerForm.walletAddress ?? ""} onChange={(e) => setProviderForm((f) => ({ ...f, walletAddress: e.target.value }))} placeholder="T... or 0x..." className="rounded-sm font-mono text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Required Confirmations</Label>
                  <Input type="number" min={1} value={providerForm.requiredConfirmations ?? ""} onChange={(e) => setProviderForm((f) => ({ ...f, requiredConfirmations: e.target.value }))} placeholder="e.g. 12" className="rounded-sm font-mono text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Memo Instructions</Label>
                  <Input value={providerForm.memo ?? ""} onChange={(e) => setProviderForm((f) => ({ ...f, memo: e.target.value }))} placeholder="e.g. Include reference number as memo" className="rounded-sm text-sm" />
                </div>
                <p className="text-xs text-muted-foreground">On-chain confirmations are not monitored automatically. An admin must verify transactions on a block explorer and report confirmations from the Payments tab.</p>
              </>
            )}
            {providerForm.type === "stripe" && (
              <p className="text-xs text-muted-foreground">Stripe is configured via the <code className="font-mono">STRIPE_SECRET_KEY</code> and <code className="font-mono">STRIPE_WEBHOOK_SECRET</code> environment secrets, not through this form.</p>
            )}
            {providerForm.type === "paypal" && (
              <p className="text-xs text-muted-foreground">PayPal is configured via the <code className="font-mono">PAYPAL_CLIENT_ID</code>, <code className="font-mono">PAYPAL_CLIENT_SECRET</code>, and <code className="font-mono">PAYPAL_WEBHOOK_ID</code> environment secrets, not through this form.</p>
            )}
            {providerForm.type === "flutterwave" && (
              <p className="text-xs text-muted-foreground">Flutterwave is configured via the <code className="font-mono">FLUTTERWAVE_SECRET_KEY</code> and <code className="font-mono">FLUTTERWAVE_WEBHOOK_HASH</code> environment secrets, not through this form.</p>
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
