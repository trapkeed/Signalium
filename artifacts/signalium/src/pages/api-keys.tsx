import { useState } from "react";
import {
  useListApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useRotateApiKey,
  useListApiKeyRegistrations,
  useDeactivateEaRegistration,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Key, Plus, Trash2, Copy, AlertTriangle, CheckCircle, Clock, RotateCw, Monitor, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type ApiKeyStatus = "active" | "revoked" | "expired" | "suspended";

const STATUS_STYLES: Record<ApiKeyStatus, string> = {
  active: "text-primary",
  revoked: "text-muted-foreground",
  expired: "text-yellow-500",
  suspended: "text-destructive",
};

const STATUS_ICONS: Record<ApiKeyStatus, typeof CheckCircle> = {
  active: CheckCircle,
  revoked: XCircle,
  expired: Clock,
  suspended: AlertTriangle,
};

function StatusBadge({ status }: { status: string }) {
  const s = (status as ApiKeyStatus) in STATUS_STYLES ? (status as ApiKeyStatus) : "revoked";
  const Icon = STATUS_ICONS[s];
  return (
    <span className={cn("flex items-center gap-1 text-xs font-mono", STATUS_STYLES[s])}>
      <Icon className="w-3 h-3" /> {status}
    </span>
  );
}

function TerminalsRow({ apiKeyId }: { apiKeyId: number }) {
  const { toast } = useToast();
  const { data: registrations = [], refetch } = useListApiKeyRegistrations(apiKeyId);
  const deactivate = useDeactivateEaRegistration();

  async function handleDeactivate(id: number) {
    try {
      await deactivate.mutateAsync({ id });
      toast({ title: "Terminal deactivated" });
      refetch();
    } catch {
      toast({ title: "Failed to deactivate terminal", variant: "destructive" });
    }
  }

  if (registrations.length === 0) {
    return (
      <div className="px-4 py-4 text-xs text-muted-foreground font-mono">
        No EA terminals registered with this key yet.
      </div>
    );
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      {registrations.map((reg) => (
        <div key={reg.id} className="flex items-center justify-between gap-3 border border-border rounded-sm px-3 py-2 bg-background/50">
          <div className="flex items-center gap-3 min-w-0">
            <Monitor className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-mono truncate">
                {reg.mt5Account ?? "unknown account"} · {reg.brokerName ?? "unknown broker"}
              </div>
              <div className="text-[11px] text-muted-foreground font-mono truncate">
                hw:{reg.hardwareId.slice(0, 12)} · build {reg.terminalBuild ?? "?"} · seen {new Date(reg.lastSeenAt).toLocaleString()}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {reg.isActive ? (
              <>
                <span className="text-xs text-primary font-mono">active</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive h-6 w-6 p-0 rounded-sm"
                  onClick={() => handleDeactivate(reg.id)}
                  title="Deactivate terminal (hardware replacement, decommission)"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground font-mono">inactive</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ApiKeys() {
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyExpiry, setNewKeyExpiry] = useState("");
  const [revealedKey, setRevealedKey] = useState<{ key: string; name: string } | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: keys = [], refetch } = useListApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const rotateKey = useRotateApiKey();

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    try {
      const expiresInDays = newKeyExpiry.trim() ? Number(newKeyExpiry.trim()) : undefined;
      const result = await createKey.mutateAsync({ data: { name: newKeyName.trim(), expiresInDays } });
      setRevealedKey({ key: result.key, name: result.name });
      setIsCreating(false);
      setNewKeyName("");
      setNewKeyExpiry("");
      refetch();
    } catch {
      toast({ title: "Failed to create API key", variant: "destructive" });
    }
  }

  async function handleRevoke(id: number) {
    try {
      await revokeKey.mutateAsync({ id });
      toast({ title: "API key revoked" });
      refetch();
    } catch {
      toast({ title: "Failed to revoke API key", variant: "destructive" });
    }
  }

  async function handleRotate(id: number) {
    try {
      const result = await rotateKey.mutateAsync({ id });
      setRevealedKey({ key: result.key, name: result.name });
      refetch();
    } catch {
      toast({ title: "Failed to rotate API key", variant: "destructive" });
    }
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key);
    toast({ title: "Key copied to clipboard" });
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight">API Keys</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate keys to authenticate your EA connections to the QDE runtime
          </p>
        </div>
        <Button onClick={() => setIsCreating(true)} className="gap-2 font-mono text-xs rounded-sm">
          <Plus className="w-4 h-4" />
          New API Key
        </Button>
      </div>

      <div className="p-8 max-w-4xl flex flex-col gap-6">
        {/* Info box */}
        <div className="border border-border bg-card rounded-sm p-4">
          <div className="flex items-start gap-3">
            <Key className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground leading-relaxed">
              Each API key can be used across multiple EA terminals — VPS migrations and hardware
              replacements don't require a new key. Register your EA with{" "}
              <code className="font-mono text-xs bg-secondary px-1 py-0.5 rounded">ApiKey</code> and it
              will show up below as a terminal you can manage individually.
            </div>
          </div>
        </div>

        {/* Keys table */}
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Key</th>
                <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Expires</th>
                <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Last Used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">
                    No API keys yet. Generate one to connect your EA.
                  </td>
                </tr>
              ) : (
                keys.map((key) => (
                  <>
                    <tr key={key.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                      <td className="px-4 py-3 font-medium">
                        <button
                          className="flex items-center gap-1.5"
                          onClick={() => setExpandedId(expandedId === key.id ? null : key.id)}
                        >
                          {expandedId === key.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {key.name}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{key.keyPrefix}</td>
                      <td className="px-4 py-3"><StatusBadge status={key.status} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : "never"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {key.lastUsedAt ? (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(key.lastUsedAt).toLocaleDateString()}
                          </span>
                        ) : "never"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {key.status !== "revoked" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 rounded-sm"
                              onClick={() => handleRotate(key.id)}
                              title="Rotate key (keeps registered terminals)"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {key.status !== "revoked" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive h-7 w-7 p-0 rounded-sm"
                              onClick={() => handleRevoke(key.id)}
                              title="Revoke key"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === key.id && (
                      <tr className="bg-secondary/10">
                        <td colSpan={6} className="p-0">
                          <TerminalsRow apiKeyId={key.id} />
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create key dialog */}
      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent className="bg-card border-border rounded-sm">
          <DialogHeader>
            <DialogTitle className="font-mono">Create API Key</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Key Name</Label>
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. MT5 Production"
                className="rounded-sm font-mono"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Expires in (days, optional)</Label>
              <Input
                value={newKeyExpiry}
                onChange={(e) => setNewKeyExpiry(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="Leave empty for no expiry"
                className="rounded-sm font-mono"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <Alert className="border-yellow-500/30 bg-yellow-500/5 rounded-sm">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <AlertDescription className="text-xs text-muted-foreground">
                The key will only be shown once after creation. Store it securely.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreating(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleCreate} disabled={!newKeyName.trim() || createKey.isPending} className="rounded-sm font-mono">
              {createKey.isPending ? "Creating..." : "Create Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reveal key dialog */}
      <Dialog open={!!revealedKey} onOpenChange={() => setRevealedKey(null)}>
        <DialogContent className="bg-card border-border rounded-sm max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-primary">Your API Key</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <Alert className="border-yellow-500/30 bg-yellow-500/5 rounded-sm">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <AlertDescription className="text-xs text-yellow-400 font-mono">
                Copy this key now. You won't be able to see it again.
              </AlertDescription>
            </Alert>
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                {revealedKey?.name}
              </Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs bg-secondary border border-border rounded-sm px-3 py-2.5 text-primary break-all">
                  {revealedKey?.key}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-sm shrink-0"
                  onClick={() => revealedKey && copyKey(revealedKey.key)}
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealedKey(null)} className="rounded-sm font-mono w-full">
              I've saved my key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
