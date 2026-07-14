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
  DollarSign,
  CheckCircle2,
} from "lucide-react";

// ─── GPU catalog ──────────────────────────────────────────────────────────────
// Names must match exactly what RunPod uses in their API / pod picker.
// Default prices are approximate RunPod Community Cloud rates (USD/hr).

export interface GpuSpec {
  name: string;        // exact RunPod GPU type string
  tier: string;        // grouping label
  defaultPrice: number; // USD / hr (approximate — admin overrides in pricing panel)
  vram: string;
}

export const GPU_CATALOG: GpuSpec[] = [
  // Consumer — RTX 30xx
  { name: "NVIDIA GeForce RTX 3070", tier: "Consumer", defaultPrice: 0.19, vram: "8 GB" },
  { name: "NVIDIA GeForce RTX 3080", tier: "Consumer", defaultPrice: 0.26, vram: "10 GB" },
  { name: "NVIDIA GeForce RTX 3080 Ti", tier: "Consumer", defaultPrice: 0.30, vram: "12 GB" },
  { name: "NVIDIA GeForce RTX 3090", tier: "Consumer", defaultPrice: 0.33, vram: "24 GB" },
  { name: "NVIDIA GeForce RTX 3090 Ti", tier: "Consumer", defaultPrice: 0.36, vram: "24 GB" },
  // Consumer — RTX 40xx
  { name: "NVIDIA GeForce RTX 4070", tier: "Consumer", defaultPrice: 0.27, vram: "12 GB" },
  { name: "NVIDIA GeForce RTX 4070 Ti", tier: "Consumer", defaultPrice: 0.35, vram: "12 GB" },
  { name: "NVIDIA GeForce RTX 4080", tier: "Consumer", defaultPrice: 0.45, vram: "16 GB" },
  { name: "NVIDIA GeForce RTX 4090", tier: "Consumer", defaultPrice: 0.74, vram: "24 GB" },
  // Professional — RTX A-series
  { name: "NVIDIA RTX A4000", tier: "Professional", defaultPrice: 0.22, vram: "16 GB" },
  { name: "NVIDIA RTX A4500", tier: "Professional", defaultPrice: 0.36, vram: "20 GB" },
  { name: "NVIDIA RTX A5000", tier: "Professional", defaultPrice: 0.38, vram: "24 GB" },
  { name: "NVIDIA RTX A6000", tier: "Professional", defaultPrice: 0.50, vram: "48 GB" },
  // Data-centre — A-series
  { name: "NVIDIA A40", tier: "Data Centre", defaultPrice: 0.79, vram: "48 GB" },
  { name: "NVIDIA A100 80GB PCIe", tier: "Data Centre", defaultPrice: 1.64, vram: "80 GB" },
  { name: "NVIDIA A100-SXM4-80GB", tier: "Data Centre", defaultPrice: 1.89, vram: "80 GB" },
  // Data-centre — V-series
  { name: "NVIDIA Tesla V100-SXM2-16GB", tier: "Data Centre", defaultPrice: 0.69, vram: "16 GB" },
  { name: "NVIDIA Tesla V100-SXM2-32GB", tier: "Data Centre", defaultPrice: 0.74, vram: "32 GB" },
  // Data-centre — L-series
  { name: "NVIDIA L4", tier: "Data Centre", defaultPrice: 0.44, vram: "24 GB" },
  { name: "NVIDIA L40", tier: "Data Centre", defaultPrice: 1.14, vram: "48 GB" },
  { name: "NVIDIA L40S", tier: "Data Centre", defaultPrice: 1.39, vram: "48 GB" },
  // Data-centre — H-series
  { name: "NVIDIA H100 PCIe", tier: "Data Centre", defaultPrice: 2.99, vram: "80 GB" },
  { name: "NVIDIA H100 80GB HBM3", tier: "Data Centre", defaultPrice: 3.99, vram: "80 GB" },
  { name: "NVIDIA H100 NVL", tier: "Data Centre", defaultPrice: 3.49, vram: "94 GB" },
  { name: "NVIDIA H200", tier: "Data Centre", defaultPrice: 4.49, vram: "141 GB" },
  // AMD
  { name: "AMD Radeon Pro W7900", tier: "AMD", defaultPrice: 0.52, vram: "48 GB" },
];

const GPU_BY_NAME = Object.fromEntries(GPU_CATALOG.map((g) => [g.name, g]));

// ─── Config / connection status banner ───────────────────────────────────────

function ConfigStatusBanner() {
  const { data: config } = useGetRunpodConfig();
  if (!config) return null;
  const configured = (config as any).configured as boolean;
  return (
    <div className={`rounded-sm border px-4 py-3 text-xs font-mono flex items-center gap-2 ${
      configured ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-500" : "border-amber-500/30 bg-amber-500/5 text-amber-500"
    }`}>
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      {configured
        ? "RunPod API key is configured. All RunPod credentials are platform-owned — the trainer only ever receives short-lived scoped worker tokens."
        : "RunPod is not configured. Set runpod.api_key in Admin → Secrets Vault (Super Admin) before launching pods."}
    </div>
  );
}

// ─── Budget guardrails ────────────────────────────────────────────────────────

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
      await updateBudget.mutateAsync({ data: {
        maxHourlyCostUsd: Number(maxHourlyCostUsd),
        maxActivePods: Number(maxActivePods),
      } });
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
        {!editing && <Button size="sm" variant="ghost" onClick={startEdit} className="font-mono text-xs rounded-sm">Edit</Button>}
      </div>
      {editing ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground">Max hourly cost (USD)</Label>
              <Input value={maxHourlyCostUsd} onChange={(e) => setMaxHourlyCostUsd(e.target.value)} className="rounded-sm font-mono text-sm" placeholder="10.00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground">Max active pods</Label>
              <Input value={maxActivePods} onChange={(e) => setMaxActivePods(e.target.value)} className="rounded-sm font-mono text-sm" placeholder="2" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="font-mono text-xs rounded-sm">Cancel</Button>
            <Button size="sm" onClick={save} disabled={updateBudget.isPending} className="font-mono text-xs rounded-sm">Save</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-xs font-mono text-muted-foreground">
          <div>Max hourly cost: <span className="text-foreground font-medium">${budget?.maxHourlyCostUsd ?? "—"}/hr</span></div>
          <div>Max active pods: <span className="text-foreground font-medium">{budget?.maxActivePods ?? "—"}</span></div>
        </div>
      )}
    </div>
  );
}

// ─── GPU Pricing panel ────────────────────────────────────────────────────────

function GpuPricingPanel() {
  const { toast } = useToast();
  const { data: config, refetch } = useGetRunpodConfig();
  const updateBudget = usePutRunpodBudget();

  // Current saved pricing from vault
  const savedPricing: Record<string, number> = (config as any)?.defaults?.gpuPricing ?? {};

  // Local edits — starts as a copy of saved pricing
  const [pricing, setPricing] = useState<Record<string, number> | null>(null);
  const effective = pricing ?? savedPricing;

  // Add-GPU form state
  const [selectedGpu, setSelectedGpu] = useState("");
  const [customPrice, setCustomPrice] = useState("");

  function startEditing() {
    if (pricing === null) setPricing({ ...savedPricing });
  }

  function addGpu() {
    if (!selectedGpu) return;
    const price = customPrice !== "" ? Number(customPrice) : (GPU_BY_NAME[selectedGpu]?.defaultPrice ?? 0);
    if (!Number.isFinite(price) || price < 0) {
      toast({ title: "Invalid price", variant: "destructive" });
      return;
    }
    setPricing((prev) => ({ ...(prev ?? savedPricing), [selectedGpu]: price }));
    setSelectedGpu("");
    setCustomPrice("");
  }

  function removeGpu(name: string) {
    setPricing((prev) => {
      const next = { ...(prev ?? savedPricing) };
      delete next[name];
      return next;
    });
  }

  function updatePrice(name: string, val: string) {
    const price = Number(val);
    if (!Number.isFinite(price) || price < 0) return;
    setPricing((prev) => ({ ...(prev ?? savedPricing), [name]: price }));
  }

  async function save() {
    if (pricing === null) return;
    try {
      await updateBudget.mutateAsync({ data: { gpuPricingJson: pricing } as any });
      await refetch();
      setPricing(null);
      toast({ title: "GPU pricing saved" });
    } catch (err: any) {
      toast({ title: "Failed to save pricing", description: err?.message, variant: "destructive" });
    }
  }

  const tiers = [...new Set(GPU_CATALOG.map((g) => g.tier))];
  const availableToAdd = GPU_CATALOG.filter((g) => !effective[g.name]);
  const configuredEntries = Object.entries(effective).sort(([a], [b]) => a.localeCompare(b));
  const isDirty = pricing !== null;

  return (
    <div className="rounded-sm border border-border p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-mono text-sm font-medium flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-primary" /> GPU Pricing
          </h3>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
            Server-trusted prices used for budget enforcement. Launches are blocked if the GPU type isn't listed here.
          </p>
        </div>
        {isDirty ? (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPricing(null)} className="font-mono text-xs rounded-sm">Discard</Button>
            <Button size="sm" onClick={save} disabled={updateBudget.isPending} className="font-mono text-xs rounded-sm">
              {updateBudget.isPending ? "Saving…" : "Save Pricing"}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={startEditing} className="font-mono text-xs rounded-sm">Edit</Button>
        )}
      </div>

      {/* Add GPU row */}
      {isDirty && (
        <div className="flex flex-wrap gap-2 items-end p-3 bg-secondary/20 rounded-sm">
          <div className="flex flex-col gap-1 flex-1 min-w-48">
            <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">GPU Type</Label>
            <select
              value={selectedGpu}
              onChange={(e) => {
                setSelectedGpu(e.target.value);
                setCustomPrice(e.target.value ? String(GPU_BY_NAME[e.target.value]?.defaultPrice ?? "") : "");
              }}
              className="h-8 rounded-sm border border-border bg-background font-mono text-xs px-2"
            >
              <option value="">Select GPU to add…</option>
              {tiers.map((tier) => {
                const gpus = availableToAdd.filter((g) => g.tier === tier);
                if (gpus.length === 0) return null;
                return (
                  <optgroup key={tier} label={`── ${tier} ──`}>
                    {gpus.map((g) => (
                      <option key={g.name} value={g.name}>
                        {g.name} ({g.vram}) — ~${g.defaultPrice}/hr
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>
          <div className="flex flex-col gap-1 w-32">
            <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Price (USD/hr)</Label>
            <Input
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
              placeholder="0.74"
              className="h-8 rounded-sm font-mono text-xs"
            />
          </div>
          <Button size="sm" onClick={addGpu} disabled={!selectedGpu} className="font-mono text-xs rounded-sm gap-1.5 h-8">
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        </div>
      )}

      {/* Current pricing table */}
      {configuredEntries.length === 0 ? (
        <div className="text-xs font-mono text-muted-foreground py-2">
          No GPU pricing configured. {!isDirty && <button onClick={startEditing} className="underline underline-offset-2">Add GPUs</button>}
        </div>
      ) : (
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider">GPU Type</th>
                <th className="text-left px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider">VRAM</th>
                <th className="text-left px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider">Tier</th>
                <th className="text-left px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider">Price / hr</th>
                {isDirty && <th className="px-3 py-2 w-10" />}
              </tr>
            </thead>
            <tbody>
              {configuredEntries.map(([name, price]) => {
                const spec = GPU_BY_NAME[name];
                return (
                  <tr key={name} className="border-b border-border last:border-0 hover:bg-secondary/10">
                    <td className="px-3 py-2 font-medium">{name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{spec?.vram ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{spec?.tier ?? "Custom"}</td>
                    <td className="px-3 py-2">
                      {isDirty ? (
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={price}
                          onChange={(e) => updatePrice(name, e.target.value)}
                          className="h-6 w-24 rounded-sm font-mono text-xs py-0"
                        />
                      ) : (
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                          ${price.toFixed(2)}/hr
                        </span>
                      )}
                    </td>
                    {isDirty && (
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-destructive" onClick={() => removeGpu(name)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Launch pod dialog ────────────────────────────────────────────────────────

function LaunchPodDialog() {
  const { toast } = useToast();
  const { data: config } = useGetRunpodConfig();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [gpuType, setGpuType] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [volumeId, setVolumeId] = useState("");
  const launchPod = usePostRunpodPods();

  const savedPricing: Record<string, number> = (config as any)?.defaults?.gpuPricing ?? {};
  const allowedGpus: string[] = (config as any)?.defaults?.allowedGpus ?? [];
  const defaultTemplate: string = (config as any)?.defaults?.templateId ?? "";
  const defaultVolume: string = (config as any)?.defaults?.volumeId ?? "";

  // GPUs available for launch: must have a price set, and must be in allowedGpus if that list is non-empty
  const launchableGpus = GPU_CATALOG.filter((g) => {
    if (!savedPricing[g.name]) return false;
    if (allowedGpus.length > 0 && !allowedGpus.includes(g.name)) return false;
    return true;
  });

  const tiers = [...new Set(launchableGpus.map((g) => g.tier))];

  const selectedSpec = GPU_BY_NAME[gpuType];

  async function handleSubmit() {
    if (!name || !gpuType || !templateId) return;
    try {
      await launchPod.mutateAsync({ data: { name, gpuType, templateId, volumeId: volumeId || undefined } });
      toast({ title: "Pod launch requested" });
      setName(""); setGpuType(""); setTemplateId(""); setVolumeId("");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to launch pod", description: err?.message ?? "Budget check failed or GPU provider error", variant: "destructive" });
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
          <DialogTitle className="font-mono text-base">Launch GPU Pod</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rp-name" className="text-xs font-mono text-muted-foreground">Pod Name</Label>
            <Input id="rp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="training-run-42" className="rounded-sm font-mono text-sm" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rp-gpu" className="text-xs font-mono text-muted-foreground">GPU Type</Label>
            {launchableGpus.length > 0 ? (
              <select
                id="rp-gpu"
                value={gpuType}
                onChange={(e) => setGpuType(e.target.value)}
                className="h-9 rounded-sm border border-border bg-background font-mono text-sm px-2"
              >
                <option value="">Select GPU…</option>
                {tiers.map((tier) => {
                  const gpus = launchableGpus.filter((g) => g.tier === tier);
                  return (
                    <optgroup key={tier} label={`── ${tier} ──`}>
                      {gpus.map((g) => (
                        <option key={g.name} value={g.name}>
                          {g.name} ({g.vram}) — ${savedPricing[g.name]?.toFixed(2)}/hr
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            ) : (
              <div className="text-xs font-mono text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-sm px-3 py-2">
                No GPU prices configured. Add prices in the GPU Pricing section before launching.
              </div>
            )}
            {selectedSpec && (
              <p className="text-[10px] font-mono text-muted-foreground">
                {selectedSpec.vram} VRAM · {selectedSpec.tier} · ${savedPricing[gpuType]?.toFixed(2)}/hr
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rp-template" className="text-xs font-mono text-muted-foreground">Template ID</Label>
            <Input id="rp-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}
              placeholder={defaultTemplate || "runpod-template-id"} className="rounded-sm font-mono text-sm" />
            {defaultTemplate && !templateId && (
              <button onClick={() => setTemplateId(defaultTemplate)} className="text-[10px] font-mono text-primary hover:underline text-left">
                Use default: {defaultTemplate}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rp-volume" className="text-xs font-mono text-muted-foreground">Volume ID (optional)</Label>
            <Input id="rp-volume" value={volumeId} onChange={(e) => setVolumeId(e.target.value)}
              placeholder={defaultVolume || "vol-..."} className="rounded-sm font-mono text-sm" />
            {defaultVolume && !volumeId && (
              <button onClick={() => setVolumeId(defaultVolume)} className="text-[10px] font-mono text-primary hover:underline text-left">
                Use default: {defaultVolume}
              </button>
            )}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost" className="rounded-sm font-mono text-xs">Cancel</Button></DialogClose>
          <Button onClick={handleSubmit} disabled={launchPod.isPending || !gpuType || !name || !templateId} className="rounded-sm font-mono text-xs">
            {launchPod.isPending ? "Launching…" : "Launch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pod credentials ──────────────────────────────────────────────────────────

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
          <Button size="sm" variant="ghost" className="h-6 px-2"
            onClick={() => { navigator.clipboard.writeText(lastIssuedToken); toast({ title: "Copied" }); }}>
            <Copy className="w-3 h-3" />
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        <Input value={scopeLabel} onChange={(e) => setScopeLabel(e.target.value)}
          placeholder="Scope label (e.g. trainer job id)" className="rounded-sm font-mono text-xs" />
        <Button size="sm" onClick={handleIssue} disabled={issueCredential.isPending}
          className="font-mono text-xs rounded-sm shrink-0 gap-1.5">
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

// ─── Logs / Artifacts ─────────────────────────────────────────────────────────

function LogsPanel({ podId }: { podId: number }) {
  const { data } = useGetRunpodPodsIdLogs(podId);
  const lines = (data as any)?.lines ?? [];
  return (
    <div className="p-3 bg-black/40 rounded-sm max-h-64 overflow-auto">
      {lines.length === 0
        ? <div className="text-xs font-mono text-muted-foreground">No logs available.</div>
        : <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap">{lines.join("\n")}</pre>}
    </div>
  );
}

function ArtifactsPanel({ podId }: { podId: number }) {
  const { data } = useGetRunpodPodsIdArtifacts(podId);
  const files = (data as any)?.files ?? [];
  return (
    <div className="p-3 bg-secondary/10 rounded-sm">
      {files.length === 0
        ? <div className="text-xs font-mono text-muted-foreground">No artifacts found on the attached volume.</div>
        : (
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

// ─── Pod row ──────────────────────────────────────────────────────────────────

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
    try { await action(); toast({ title: label }); }
    catch (err: any) { toast({ title: `Failed: ${label}`, description: err?.message, variant: "destructive" }); }
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
          {pod.lastReportedCostPerHrUsd != null
            ? `$${pod.lastReportedCostPerHrUsd}/hr`
            : pod.costPerHrUsd != null ? `$${pod.costPerHrUsd}/hr (quoted)` : "—"}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
          {pod.lastUtilizationPct != null ? `${pod.lastUtilizationPct}%` : "—"}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1 justify-end">
            <Button size="sm" variant="ghost" className="h-7 px-2"
              onClick={() => run(() => refreshPod.mutateAsync({ id: pod.id }), "Refreshed")}>
              <RotateCw className="w-3.5 h-3.5" />
            </Button>
            {active && (
              <Button size="sm" variant="ghost" className="h-7 px-2"
                onClick={() => run(() => stopPod.mutateAsync({ id: pod.id }), "Pod stopped")}>
                <Square className="w-3.5 h-3.5" />
              </Button>
            )}
            {canRestart && (
              <Button size="sm" variant="ghost" className="h-7 px-2"
                onClick={() => run(() => restartPod.mutateAsync({ id: pod.id }), "Pod restarted")}>
                <Play className="w-3.5 h-3.5" />
              </Button>
            )}
            {canTerminate && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive"
                onClick={() => run(() => terminatePod.mutateAsync({ id: pod.id }), "Pod terminated")}>
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
              {(["logs", "artifacts", "credentials"] as const).map((t) => (
                <Button key={t} size="sm" variant={tab === t ? "default" : "ghost"}
                  className="h-7 px-2.5 font-mono text-xs gap-1.5" onClick={() => setTab(t)}>
                  {t === "logs" ? <FileText className="w-3.5 h-3.5" /> : t === "artifacts" ? <FolderOpen className="w-3.5 h-3.5" /> : <KeyRound className="w-3.5 h-3.5" />}
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Button>
              ))}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminRunpod() {
  const { data: pods, isLoading } = useGetRunpodPods();

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight flex items-center gap-2">
          <Server className="w-5 h-5 text-primary" /> GPU Orchestration
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage GPU pods for model training. All credentials are platform-owned — trainers receive only short-lived scoped tokens.
        </p>
      </div>

      <div className="flex-1 p-8 flex flex-col gap-6 max-w-5xl">
        <div className="flex justify-end">
          <LaunchPodDialog />
        </div>

        <ConfigStatusBanner />
        <BudgetPanel />
        <GpuPricingPanel />

        <div className="rounded-sm border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/20">
                {["Pod", "GPU", "Status", "Cost", "Utilization", ""].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-mono font-medium text-muted-foreground">{h}</th>
                ))}
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
    </div>
  );
}
