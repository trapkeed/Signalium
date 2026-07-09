import { useState } from "react";
import {
  useGetRunpodConfig,
  useGetRunpodPods,
  usePutRunpodBudget,
  usePostRunpodPods,
  usePostRunpodPodsIdStop,
  usePostRunpodPodsIdRestart,
  usePostRunpodPodsIdTerminate,
  usePostRunpodPodsIdRefresh,
  useGetRunpodPodsIdLogs,
  useGetRunpodPodsIdArtifacts,
  useGetRunpodPodsIdCredentials,
  usePostRunpodPodsIdCredentials,
  usePostRunpodCredentialsCredentialIdRotate,
  useDeleteRunpodCredentialsCredentialId,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Server,
  Plus,
  Square,
  Play,
  Trash2,
  RotateCw,
  FileText,
  FolderOpen,
  KeyRound,
  Copy,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";

function ConfigStatusBanner() {
  const { data: config } = useGetRunpodConfig();
  if (!config) return null;
  const configured = (config as any).configured as boolean;
  return (
    <div
      className={`rounded-sm border px-4 py-3 text-xs font-mono flex items-center gap-2 ${
        configured ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-500" : "border-amber-500/30 bg-amber-500/5 text-amber-500"
      }`}
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      {configured
        ? "RunPod API key is configured. Signalium owns all RunPod credentials — the trainer never receives this key, only short-lived scoped worker tokens."
        : "RunPod is not configured. Set runpod.api_key in Admin \u2192 Secrets Vault (Super Admin) before launching pods."}
    </div>
  );
}

function BudgetPanel() {
  const { toast } = useToast();
  const { data: config } = useGetRunpodConfig();
  const updateBudget = usePutRunpodBudget();
  const budget = (config as any)?.budget;
  const [maxHourlyCostUsd, setMaxHourlyCostUsd] = useState("");
  const [maxActivePods, setMaxActivePods] = useState("");
  const [editing, setEditing] = useState(false);

  function startEdit() {
    setMaxHourlyCostUsd(String(budget?.maxHourlyCostUsd ?? 10));
    setMaxActivePods(String(budget?.maxActivePods ?? 2));
    setEditing(true);
  }

  async function save() {
    try {
      await updateBudget.mutateAsync({
        data: {
          maxHourlyCostUsd: Number(maxHourlyCostUsd),
          maxActivePods: Number(maxActivePods),
        },
      });
      toast({ title: "Budget updated" });
      setEditing(false);
    } catch (err: any) {
      toast({ title: "Failed to update budget", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="rounded-sm border border-border p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm font-medium">Budget Guardrails</h3>
        {!editing && (
          <Button size="sm" variant="ghost" onClick={startEdit} className="font-mono text-xs rounded-sm">
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground">Max hourly cost (USD)</Label>
              <Input value={maxHourlyCostUsd} onChange={(e) => setMaxHourlyCostUsd(e.target.value)} className="rounded-sm font-mono text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground">Max active pods</Label>
              <Input value={maxActivePods} onChange={(e) => setMaxActivePods(e.target.value)} className="rounded-sm font-mono text-sm" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="font-mono text-xs rounded-sm">Cancel</Button>
            <Button size="sm" onClick={save} disabled={updateBudget.isPending} className="font-mono text-xs rounded-sm">Save</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-xs font-mono text-muted-foreground">
          <div>Max hourly cost: <span className="text-foreground">${budget?.maxHourlyCostUsd ?? "—"}/hr</span></div>
          <div>Max active pods: <span className="text-foreground">{budget?.maxActivePods ?? "—"}</span></div>
        </div>
      )}
    </div>
  );
}

function LaunchPodDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [gpuType, setGpuType] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [volumeId, setVolumeId] = useState("");
  const launchPod = usePostRunpodPods();

  async function handleSubmit() {
    if (!name || !gpuType || !templateId) return;
    try {
      await launchPod.mutateAsync({
        data: {
          name,
          gpuType,
          templateId,
          volumeId: volumeId || undefined,
        },
      });
      toast({ title: "Pod launch requested" });
      setName(""); setGpuType(""); setTemplateId(""); setVolumeId("");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to launch pod", description: err?.message ?? "Budget check failed or RunPod error", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 font-mono text-xs rounded-sm">
          <Plus className="w-3.5 h-3.5" /> Launch Pod
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">Launch RunPod GPU Pod</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {[
            { id: "rp-name", label: "Name", val: name, set: setName, placeholder: "training-run-42" },
            { id: "rp-gpu", label: "GPU type", val: gpuType, set: setGpuType, placeholder: "NVIDIA A100" },
            { id: "rp-template", label: "Template ID", val: templateId, set: setTemplateId, placeholder: "runpod-template-id" },
            { id: "rp-volume", label: "Volume ID (optional)", val: volumeId, set: setVolumeId, placeholder: "vol-..." },
          ].map(({ id, label, val, set, placeholder }) => (
            <div key={id} className="flex flex-col gap-1.5">
              <Label htmlFor={id} className="text-xs font-mono text-muted-foreground">{label}</Label>
              <Input id={id} value={val} onChange={(e) => set(e.target.value)} placeholder={placeholder} className="rounded-sm font-mono text-sm" />
            </div>
          ))}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost" className="rounded-sm font-mono text-xs">Cancel</Button></DialogClose>
          <Button onClick={handleSubmit} disabled={launchPod.isPending} className="rounded-sm font-mono text-xs">Launch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredentialsPanel({ podId }: { podId: number }) {
  const { toast } = useToast();
  const { data: credentials } = useGetRunpodPodsIdCredentials(podId);
  const issueCredential = usePostRunpodPodsIdCredentials();
  const rotateCredential = usePostRunpodCredentialsCredentialIdRotate();
  const revokeCredential = useDeleteRunpodCredentialsCredentialId();
  const [scopeLabel, setScopeLabel] = useState("");
  const [lastIssuedToken, setLastIssuedToken] = useState<string | null>(null);

  async function handleIssue() {
    try {
      const result = await issueCredential.mutateAsync({ id: podId, data: { scopeLabel: scopeLabel || undefined } });
      setLastIssuedToken((result as any).token);
      setScopeLabel("");
      toast({ title: "Worker credential issued", description: "Copy it now — it will not be shown again." });
    } catch (err: any) {
      toast({ title: "Failed to issue credential", description: err?.message, variant: "destructive" });
    }
  }

  async function handleRotate(credentialId: number) {
    try {
      const result = await rotateCredential.mutateAsync({ credentialId });
      setLastIssuedToken((result as any).token);
      toast({ title: "Credential rotated", description: "Copy the new token — it will not be shown again." });
    } catch (err: any) {
      toast({ title: "Failed to rotate credential", description: err?.message, variant: "destructive" });
    }
  }

  async function handleRevoke(credentialId: number) {
    try {
      await revokeCredential.mutateAsync({ credentialId });
      toast({ title: "Credential revoked" });
    } catch (err: any) {
      toast({ title: "Failed to revoke credential", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3 bg-secondary/10 rounded-sm">
      {lastIssuedToken && (
        <div className="flex items-center gap-2 p-2 rounded-sm border border-emerald-500/30 bg-emerald-500/5">
          <code className="text-xs font-mono truncate flex-1">{lastIssuedToken}</code>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={() => { navigator.clipboard.writeText(lastIssuedToken); toast({ title: "Copied" }); }}
          >
            <Copy className="w-3 h-3" />
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={scopeLabel}
          onChange={(e) => setScopeLabel(e.target.value)}
          placeholder="Scope label (e.g. trainer job id)"
          className="rounded-sm font-mono text-xs"
        />
        <Button size="sm" onClick={handleIssue} disabled={issueCredential.isPending} className="font-mono text-xs rounded-sm shrink-0 gap-1.5">
          <KeyRound className="w-3.5 h-3.5" /> Issue 60-min credential
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        {((credentials as any[]) ?? []).map((cred) => {
          const revoked = !!cred.revokedAt;
          const expired = new Date(cred.expiresAt).getTime() < Date.now();
          return (
            <div key={cred.id} className="flex items-center justify-between text-xs font-mono gap-2 py-1.5 px-2 border-b border-border last:border-0">
              <div className="flex items-center gap-2 truncate">
                <span className="text-muted-foreground truncate">{cred.tokenPrefix}</span>
                {cred.scopeLabel && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{cred.scopeLabel}</Badge>}
                <Badge variant={revoked ? "destructive" : expired ? "secondary" : "default"} className="text-[10px] px-1.5 py-0">
                  {revoked ? "revoked" : expired ? "expired" : "active"}
                </Badge>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!revoked && (
                  <>
                    <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => handleRotate(cred.id)}>
                      <RotateCw className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-destructive" onClick={() => handleRevoke(cred.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {((credentials as any[]) ?? []).length === 0 && (
          <div className="text-xs font-mono text-muted-foreground py-1">No worker credentials issued yet.</div>
        )}
      </div>
    </div>
  );
}

function LogsPanel({ podId }: { podId: number }) {
  const { data } = useGetRunpodPodsIdLogs(podId);
  const lines = (data as any)?.lines ?? [];
  return (
    <div className="p-3 bg-black/40 rounded-sm max-h-64 overflow-auto">
      {lines.length === 0 ? (
        <div className="text-xs font-mono text-muted-foreground">No logs available.</div>
      ) : (
        <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap">{lines.join("\n")}</pre>
      )}
    </div>
  );
}

function ArtifactsPanel({ podId }: { podId: number }) {
  const { data } = useGetRunpodPodsIdArtifacts(podId);
  const files = (data as any)?.files ?? [];
  return (
    <div className="p-3 bg-secondary/10 rounded-sm">
      {files.length === 0 ? (
        <div className="text-xs font-mono text-muted-foreground">No artifacts found on the attached volume.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {files.map((f: any) => (
            <div key={f.name} className="flex justify-between text-xs font-mono">
              <span>{f.name}</span>
              <span className="text-muted-foreground">{(f.sizeBytes / 1_000_000).toFixed(1)} MB</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  running: "default",
  provisioning: "secondary",
  pending: "secondary",
  restarting: "secondary",
  stopped: "secondary",
  terminating: "secondary",
  terminated: "destructive",
  failed: "destructive",
};

function PodRow({ pod }: { pod: any }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<"logs" | "artifacts" | "credentials">("logs");
  const stopPod = usePostRunpodPodsIdStop();
  const restartPod = usePostRunpodPodsIdRestart();
  const terminatePod = usePostRunpodPodsIdTerminate();
  const refreshPod = usePostRunpodPodsIdRefresh();

  const active = ["running", "provisioning", "pending", "restarting"].includes(pod.status);
  const canRestart = pod.status === "stopped";
  const canTerminate = pod.status !== "terminated" && pod.status !== "terminating";

  async function run(action: () => Promise<unknown>, label: string) {
    try {
      await action();
      toast({ title: label });
    } catch (err: any) {
      toast({ title: `Failed to ${label.toLowerCase()}`, description: err?.message, variant: "destructive" });
    }
  }

  return (
    <>
      <tr className="border-b border-border last:border-0 hover:bg-secondary/20">
        <td className="px-4 py-3 font-mono text-xs font-medium">
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1.5 focus-visible:outline-none">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Server className="w-3.5 h-3.5 text-primary" />
            {pod.name}
          </button>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{pod.gpuType}</td>
        <td className="px-4 py-3">
          <Badge variant={STATUS_VARIANT[pod.status] ?? "secondary"} className="text-[10px] px-1.5 py-0 font-mono">{pod.status}</Badge>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
          {pod.lastReportedCostPerHrUsd != null ? `$${pod.lastReportedCostPerHrUsd}/hr` : pod.costPerHrUsd != null ? `$${pod.costPerHrUsd}/hr (quoted)` : "—"}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
          {pod.lastUtilizationPct != null ? `${pod.lastUtilizationPct}%` : "—"}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1 justify-end">
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => run(() => refreshPod.mutateAsync({ id: pod.id }), "Refreshed")}>
              <RotateCw className="w-3.5 h-3.5" />
            </Button>
            {active && (
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => run(() => stopPod.mutateAsync({ id: pod.id }), "Pod stopped")}>
                <Square className="w-3.5 h-3.5" />
              </Button>
            )}
            {canRestart && (
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => run(() => restartPod.mutateAsync({ id: pod.id }), "Pod restarted")}>
                <Play className="w-3.5 h-3.5" />
              </Button>
            )}
            {canTerminate && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => run(() => terminatePod.mutateAsync({ id: pod.id }), "Pod terminated")}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border last:border-0 bg-secondary/5">
          <td colSpan={6} className="px-4 py-3">
            <div className="flex gap-1.5 mb-3">
              <Button size="sm" variant={tab === "logs" ? "default" : "ghost"} className="h-7 px-2.5 font-mono text-xs gap-1.5" onClick={() => setTab("logs")}>
                <FileText className="w-3.5 h-3.5" /> Logs
              </Button>
              <Button size="sm" variant={tab === "artifacts" ? "default" : "ghost"} className="h-7 px-2.5 font-mono text-xs gap-1.5" onClick={() => setTab("artifacts")}>
                <FolderOpen className="w-3.5 h-3.5" /> Artifacts
              </Button>
              <Button size="sm" variant={tab === "credentials" ? "default" : "ghost"} className="h-7 px-2.5 font-mono text-xs gap-1.5" onClick={() => setTab("credentials")}>
                <KeyRound className="w-3.5 h-3.5" /> Worker Credentials
              </Button>
            </div>
            {tab === "logs" && <LogsPanel podId={pod.id} />}
            {tab === "artifacts" && <ArtifactsPanel podId={pod.id} />}
            {tab === "credentials" && <CredentialsPanel podId={pod.id} />}
          </td>
        </tr>
      )}
    </>
  );
}

export default function AdminRunpod() {
  const { data: pods, isLoading } = useGetRunpodPods();

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" /> RunPod GPU Orchestration
          </h1>
          <p className="text-xs font-mono text-muted-foreground mt-1">
            Signalium owns all RunPod credentials and lifecycle. The trainer only ever receives short-lived (60 min) scoped worker tokens, never the underlying API key.
          </p>
        </div>
        <LaunchPodDialog />
      </div>

      <ConfigStatusBanner />
      <BudgetPanel />

      <div className="rounded-sm border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-secondary/20">
              <th className="px-4 py-2 text-left text-xs font-mono font-medium text-muted-foreground">Pod</th>
              <th className="px-4 py-2 text-left text-xs font-mono font-medium text-muted-foreground">GPU</th>
              <th className="px-4 py-2 text-left text-xs font-mono font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-2 text-left text-xs font-mono font-medium text-muted-foreground">Cost</th>
              <th className="px-4 py-2 text-left text-xs font-mono font-medium text-muted-foreground">Utilization</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-xs font-mono text-muted-foreground">Loading…</td></tr>
            )}
            {!isLoading && ((pods as any[]) ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-xs font-mono text-muted-foreground">No pods launched yet.</td></tr>
            )}
            {((pods as any[]) ?? []).map((pod) => <PodRow key={pod.id} pod={pod} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
