import { useState } from "react";
import {
  useGetOwnAuditLog,
  useGetConsent,
  useRecordConsent,
  useExportAccountData,
  useGetAccountDeletionStatus,
  useRequestAccountDeletion,
  useConfirmAccountDeletion,
  useCancelAccountDeletion,
  getGetConsentQueryKey,
  getGetAccountDeletionStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Download, Trash2, ShieldQuestion, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";

const CONSENT_TYPES = [
  { type: "marketing_communications" as const, label: "Marketing communications", description: "Product updates and offers by email" },
];

const CONSENT_VERSION = "2026-07-09";

export function PrivacyTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmToken, setConfirmToken] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const { data: auditLog = [] } = useGetOwnAuditLog();
  const { data: consent = [] } = useGetConsent();
  const { data: deletionStatus, refetch: refetchDeletion } = useGetAccountDeletionStatus();
  const recordConsent = useRecordConsent();
  const exportData = useExportAccountData();
  const requestDeletion = useRequestAccountDeletion();
  const confirmDeletion = useConfirmAccountDeletion();
  const cancelDeletion = useCancelAccountDeletion();

  function isGranted(consentType: string) {
    return consent.find((c) => c.consentType === consentType)?.granted ?? false;
  }

  async function handleConsentToggle(consentType: (typeof CONSENT_TYPES)[number]["type"], granted: boolean) {
    try {
      await recordConsent.mutateAsync({ data: { consentType, version: CONSENT_VERSION, granted } });
      queryClient.invalidateQueries({ queryKey: getGetConsentQueryKey() });
    } catch {
      toast({ title: "Failed to update consent", variant: "destructive" });
    }
  }

  async function handleExport() {
    try {
      const result = await exportData.mutateAsync();
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `signalium-data-export-${new Date().toISOString()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export ready", description: "Your data has been downloaded and cryptographically signed." });
    } catch {
      toast({ title: "Failed to export data", variant: "destructive" });
    }
  }

  async function handleRequestDeletion() {
    try {
      await requestDeletion.mutateAsync();
      toast({ title: "Deletion requested", description: "Check your email for a confirmation link." });
      setIsDeleting(false);
      refetchDeletion();
      queryClient.invalidateQueries({ queryKey: getGetAccountDeletionStatusQueryKey() });
    } catch {
      toast({ title: "Failed to request account deletion", variant: "destructive" });
    }
  }

  async function handleConfirmDeletion() {
    if (!confirmToken.trim()) return;
    try {
      await confirmDeletion.mutateAsync({ data: { token: confirmToken.trim() } });
      toast({ title: "Deletion confirmed", description: "Your account is now scheduled for deletion." });
      setShowConfirmDialog(false);
      setConfirmToken("");
      refetchDeletion();
    } catch {
      toast({ title: "Invalid or expired confirmation link", variant: "destructive" });
    }
  }

  async function handleCancelDeletion() {
    try {
      await cancelDeletion.mutateAsync();
      toast({ title: "Deletion cancelled" });
      refetchDeletion();
    } catch {
      toast({ title: "Failed to cancel deletion", variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Consent */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Consent Preferences</div>
        <div className="flex flex-col gap-3">
          {CONSENT_TYPES.map((c) => (
            <div key={c.type} className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <Label className="text-sm font-medium">{c.label}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
              </div>
              <Switch checked={isGranted(c.type)} onCheckedChange={(v) => handleConsentToggle(c.type, v)} />
            </div>
          ))}
        </div>
      </div>

      {/* Data export */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Export Your Data</div>
        <Card className="border-border">
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">Download a complete, cryptographically signed copy of your account data.</p>
            <Button size="sm" variant="outline" className="rounded-lg gap-2 shrink-0" onClick={handleExport} disabled={exportData.isPending}>
              <Download className="w-3.5 h-3.5" /> {exportData.isPending ? "Exporting…" : "Export"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Own audit trail */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Your Account Activity</div>
        {auditLog.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recorded activity yet.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.slice(0, 20).map((e) => (
                  <tr key={e.id} className="border-b border-border/50">
                    <td className="px-3 py-2">{e.action.replace(/[._]/g, " ")}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Account deletion */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Delete Account</div>
        {deletionStatus?.active ? (
          <Alert className="border-amber-500/30 bg-amber-500/5 rounded-lg">
            <ShieldQuestion className="w-4 h-4 text-amber-500" />
            <AlertDescription className="text-sm">
              {deletionStatus.active.status === "pending_confirmation" ? (
                <>
                  <div className="font-medium mb-1">Deletion pending confirmation</div>
                  <div className="text-muted-foreground mb-3">Check your email for a confirmation link, or enter the code below.</div>
                  <div className="flex gap-2">
                    <Input placeholder="Confirmation token" value={confirmToken} onChange={(e) => setConfirmToken(e.target.value)} className="rounded-lg" />
                    <Button size="sm" onClick={handleConfirmDeletion} disabled={confirmDeletion.isPending}>Confirm</Button>
                  </div>
                </>
              ) : (
                <div className="font-medium mb-1">
                  Account scheduled for deletion{deletionStatus.active.scheduledFor && ` on ${new Date(deletionStatus.active.scheduledFor).toLocaleDateString()}`}
                </div>
              )}
              <Button size="sm" variant="outline" className="mt-3 rounded-lg" onClick={handleCancelDeletion} disabled={cancelDeletion.isPending}>
                Cancel deletion
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <Card className="border-destructive/20">
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Permanently anonymize and deactivate your account after a grace period. Payment and audit history are retained as required by law.
              </p>
              <Button size="sm" variant="destructive" className="rounded-lg gap-2 shrink-0" onClick={() => setIsDeleting(true)}>
                <Trash2 className="w-3.5 h-3.5" /> Delete account
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={isDeleting} onOpenChange={setIsDeleting}>
        <DialogContent className="rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="w-4 h-4" /> Delete your account?</DialogTitle>
            <DialogDescription>
              We'll email you a confirmation link. Nothing is deleted until you confirm, and you can cancel any time before the grace period ends.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleting(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRequestDeletion} disabled={requestDeletion.isPending}>
              {requestDeletion.isPending ? "Requesting…" : "Send confirmation email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
