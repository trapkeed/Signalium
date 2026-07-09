/**
 * S18 — Admin Inference Gateway Page
 *
 * - Global inference controls (pause autonomous, disable inference, force model version)
 * - Opportunities state machine viewer
 * - Market memory viewer
 */
import { useState, useEffect } from "react";
import {
  useGetInferenceControls,
  useUpdateInferenceControls,
  useListAllOpportunities,
  useTransitionOpportunity,
  useListMarketMemory,
  useCreateMarketMemoryEntry,
  useListDataProvidersAdmin,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Brain,
  Play,
  Pause,
  Radio,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Target,
  Eye,
  TrendingUp,
  BookOpen,
  Layers,
  ArrowUp,
  ArrowDown,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import type { Opportunity, InferenceControls, MarketMemoryEntry } from "@workspace/api-client-react";

const POLL_MS = 8000;

const STATE_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  WATCHING:          { label: "Watching",          color: "text-muted-foreground",  icon: Eye },
  BUILDING_CONTEXT:  { label: "Building Context",  color: "text-blue-400",          icon: Layers },
  PREPARING_ENTRY:   { label: "Preparing Entry",   color: "text-yellow-400",        icon: Target },
  ENTRY_WINDOW:      { label: "Entry Window",      color: "text-orange-400",        icon: Clock },
  POSITION_ACTIVE:   { label: "Position Active",   color: "text-primary",           icon: TrendingUp },
  MANAGING_POSITION: { label: "Managing Position", color: "text-primary",           icon: Radio },
  EXIT_PREPARATION:  { label: "Exit Prep",         color: "text-yellow-400",        icon: AlertTriangle },
  EXITED:            { label: "Exited",             color: "text-muted-foreground",  icon: CheckCircle2 },
  COOLDOWN:          { label: "Cooldown",           color: "text-muted-foreground",  icon: Pause },
};

const ALL_STATES = Object.keys(STATE_CONFIG) as (keyof typeof STATE_CONFIG)[];
const MEMORY_KINDS = ["failed_setup", "successful_setup", "regime_transition", "session_behavior", "volatility_behavior"] as const;

const PRIORITY_LABELS: Record<string, string> = {
  EA_FEED: "EA Feed",
  oanda: "OANDA",
  tiingo: "Tiingo",
};

// ─── Autonomous market priority ────────────────────────────────────────────────

function AutonomousPriorityPanel({
  controls,
  onSave,
  isPending,
}: {
  controls: InferenceControls | undefined;
  onSave: (priority: string[]) => void;
  isPending: boolean;
}) {
  const [order, setOrder] = useState<string[]>(
    (controls?.autonomousMarketPriority as string[] | undefined) ?? ["EA_FEED", "oanda", "tiingo"]
  );

  useEffect(() => {
    if (controls?.autonomousMarketPriority) {
      setOrder(controls.autonomousMarketPriority as string[]);
    }
  }, [controls?.autonomousMarketPriority]);

  function move(index: number, dir: -1 | 1) {
    const next = [...order];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    onSave(next);
  }

  return (
    <div className="border border-border rounded-sm p-5 flex flex-col gap-3">
      <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground">Autonomous Mode — Market Source Priority</h3>
      <p className="text-xs text-muted-foreground font-mono">
        In autonomous mode, users' market data resolves EA-feed-first following this order, failing over down the list when a source is unavailable.
      </p>
      <div className="flex flex-col gap-1.5">
        {order.map((source, i) => (
          <div key={source} className="flex items-center gap-3 bg-secondary/20 rounded-sm px-3 py-2">
            <span className="w-5 text-center font-mono text-xs text-muted-foreground">{i + 1}</span>
            <Server className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="font-mono text-xs font-medium flex-1">{PRIORITY_LABELS[source] ?? source}</span>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 rounded-sm" disabled={i === 0 || isPending} onClick={() => move(i, -1)}>
              <ArrowUp className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 rounded-sm" disabled={i === order.length - 1 || isPending} onClick={() => move(i, 1)}>
              <ArrowDown className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Inference Controls ───────────────────────────────────────────────────────

function InferenceControlsPanel() {
  const { toast } = useToast();
  const { data: controls, isLoading } = useGetInferenceControls({ query: { refetchInterval: POLL_MS } as any });
  const { data: providers = [] } = useListDataProvidersAdmin();
  const update = useUpdateInferenceControls();
  const [modelVersion, setModelVersion] = useState("");

  async function patch(values: Parameters<typeof update.mutateAsync>[0]["data"]) {
    try {
      await update.mutateAsync({ data: values });
    } catch (err: any) {
      toast({ title: "Failed to update controls", description: err?.message, variant: "destructive" });
    }
  }

  if (isLoading) return <div className="text-xs text-muted-foreground font-mono">Loading…</div>;

  const c = controls as InferenceControls | undefined;

  return (
    <div className="flex flex-col gap-6 max-w-2xl">

      {/* Master switches */}
      <div className="border border-border rounded-sm p-5 flex flex-col gap-4">
        <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground">Master Switches</h3>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium font-mono">Inference Enabled</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              When disabled, all /qde/inference* endpoints return 403. EAs continue to receive telemetry-based HOLD actions.
            </p>
          </div>
          <Switch
            checked={c?.inferenceEnabled ?? true}
            onCheckedChange={(v) => patch({ inferenceEnabled: v })}
            disabled={update.isPending}
          />
        </div>

        <div className="border-t border-border" />

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium font-mono">Autonomous Mode Paused</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              Overrides all user autonomous-mode settings. No trade instructions will be sent to any EA. Telemetry still recorded.
            </p>
          </div>
          <Switch
            checked={c?.autonomousPaused ?? false}
            onCheckedChange={(v) => patch({ autonomousPaused: v })}
            disabled={update.isPending}
          />
        </div>
      </div>

      {/* Model version */}
      <div className="border border-border rounded-sm p-5 flex flex-col gap-3">
        <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground">Model Version</h3>
        <p className="text-xs text-muted-foreground font-mono">
          Current: <span className="text-foreground">{c?.forcedModelVersion ?? "trainer default"}</span>
        </p>
        <div className="flex gap-2">
          <Input
            value={modelVersion}
            onChange={(e) => setModelVersion(e.target.value)}
            placeholder="e.g. v2.4.1  (blank = trainer default)"
            className="rounded-sm font-mono text-xs h-8"
          />
          <Button
            size="sm"
            onClick={() => { patch({ forcedModelVersion: modelVersion || null }); setModelVersion(""); }}
            disabled={update.isPending}
            className="h-8 text-xs font-mono rounded-sm"
          >
            Set
          </Button>
        </div>
      </div>

      {/* Provider selection */}
      <div className="border border-border rounded-sm p-5 flex flex-col gap-3">
        <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground">Live Data Provider</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Primary Live Provider</Label>
            <select
              value={c?.liveProviderId ?? ""}
              onChange={(e) => patch({ liveProviderId: e.target.value ? Number(e.target.value) : null })}
              className="h-8 rounded-sm border border-border bg-background font-mono text-xs px-2"
            >
              <option value="">— trainer default —</option>
              {(providers as any[]).map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Fallback Provider</Label>
            <select
              value={c?.fallbackProviderId ?? ""}
              onChange={(e) => patch({ fallbackProviderId: e.target.value ? Number(e.target.value) : null })}
              className="h-8 rounded-sm border border-border bg-background font-mono text-xs px-2"
            >
              <option value="">— none —</option>
              {(providers as any[]).map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground font-mono">
          Last updated: {c?.updatedAt ? new Date(c.updatedAt).toLocaleString() : "—"}
          {c?.updatedBy ? ` by ${c.updatedBy.slice(0, 12)}…` : ""}
        </p>
      </div>

      <AutonomousPriorityPanel
        controls={c}
        isPending={update.isPending}
        onSave={(priority) => patch({ autonomousMarketPriority: priority as any })}
      />

      {/* Status banner */}
      {(c?.autonomousPaused || !c?.inferenceEnabled) && (
        <div className="flex items-start gap-2 rounded-sm bg-amber-500/10 border border-amber-500/30 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-600 dark:text-amber-400 font-mono">
            {!c?.inferenceEnabled && <p>⚠ Inference is disabled. All inference endpoints return 403.</p>}
            {c?.autonomousPaused && <p>⚠ Autonomous trading is globally paused. No EA trade instructions will be sent.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Opportunities viewer ──────────────────────────────────────────────────────

function TransitionDialog({ opp }: { opp: Opportunity }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<string>("");
  const [reason, setReason] = useState("");
  const transition = useTransitionOpportunity();

  async function handleTransition() {
    if (!state) return;
    try {
      await transition.mutateAsync({ id: opp.id, data: { state: state as any, reason: reason || undefined } });
      toast({ title: `Opportunity → ${state}` });
      setOpen(false);
      setState(""); setReason("");
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-6 text-[10px] font-mono rounded-sm px-2">Override</Button>
      </DialogTrigger>
      <DialogContent className="rounded-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Force State Transition</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">New State</Label>
            <select value={state} onChange={(e) => setState(e.target.value)} className="h-8 rounded-sm border border-border bg-background font-mono text-xs px-2">
              <option value="">select state…</option>
              {ALL_STATES.filter((s) => s !== opp.state).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Admin override reason" className="rounded-sm font-mono text-xs h-8" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost" className="rounded-sm font-mono text-xs">Cancel</Button></DialogClose>
          <Button onClick={handleTransition} disabled={!state || transition.isPending} className="rounded-sm font-mono text-xs">Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpportunitiesPanel() {
  const { data: opps = [], isLoading } = useListAllOpportunities({ query: { refetchInterval: POLL_MS } as any });

  return (
    <div className="border border-border rounded-sm overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-secondary/30">
            {["ID", "User", "Symbol", "State", "Direction", "Confidence", "Last Evaluated", ""].map((h) => (
              <th key={h} className="text-left px-3 py-2.5 font-mono text-muted-foreground uppercase tracking-wider text-[10px]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground font-mono text-xs">Loading…</td></tr>
          ) : (opps as Opportunity[]).length === 0 ? (
            <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground font-mono text-xs">No opportunities yet</td></tr>
          ) : (
            (opps as Opportunity[]).map((opp) => {
              const sc = STATE_CONFIG[opp.state] ?? STATE_CONFIG.WATCHING;
              const Icon = sc.icon;
              return (
                <tr key={opp.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                  <td className="px-3 py-2 font-mono text-muted-foreground">#{opp.id}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{opp.userId.slice(0, 8)}…</td>
                  <td className="px-3 py-2 font-mono font-medium">{opp.symbol}</td>
                  <td className="px-3 py-2">
                    <span className={`flex items-center gap-1 font-mono ${sc.color}`}>
                      <Icon className="w-3 h-3" /> {sc.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">{opp.direction ?? "—"}</td>
                  <td className="px-3 py-2 font-mono">
                    {opp.confidence != null ? `${(opp.confidence * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {opp.lastEvaluatedAt ? new Date(opp.lastEvaluatedAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <TransitionDialog opp={opp} />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Market Memory viewer ──────────────────────────────────────────────────────

function AddMemoryDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [kind, setKind] = useState<string>("");
  const [description, setDescription] = useState("");
  const [confidence, setConfidence] = useState("");
  const [outcome, setOutcome] = useState("");
  const add = useCreateMarketMemoryEntry();

  async function handleAdd() {
    if (!symbol || !kind || !description) return;
    try {
      await add.mutateAsync({ data: { symbol, kind: kind as any, description, confidence: confidence ? Number(confidence) : undefined, outcome: outcome || undefined } });
      toast({ title: "Memory entry created" });
      setSymbol(""); setKind(""); setDescription(""); setConfidence(""); setOutcome("");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 font-mono text-xs rounded-sm h-7"><Plus />Add Entry</Button>
      </DialogTrigger>
      <DialogContent className="rounded-sm">
        <DialogHeader><DialogTitle className="font-mono text-sm">New Market Memory Entry</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <div className="flex flex-col gap-1.5 flex-1">
              <Label className="text-xs font-mono text-muted-foreground">Symbol</Label>
              <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="XAUUSD" className="rounded-sm font-mono text-xs h-8" />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <Label className="text-xs font-mono text-muted-foreground">Kind</Label>
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 rounded-sm border border-border bg-background font-mono text-xs px-2">
                <option value="">select…</option>
                {MEMORY_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Description</Label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Pattern or behavior observed…" rows={3} className="w-full rounded-sm border border-border bg-background font-mono text-xs px-3 py-2 resize-none" />
          </div>
          <div className="flex gap-2">
            <div className="flex flex-col gap-1.5 flex-1">
              <Label className="text-xs font-mono text-muted-foreground">Confidence (0–1)</Label>
              <Input value={confidence} onChange={(e) => setConfidence(e.target.value)} placeholder="0.8" type="number" min="0" max="1" step="0.1" className="rounded-sm font-mono text-xs h-8" />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <Label className="text-xs font-mono text-muted-foreground">Outcome (optional)</Label>
              <Input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Price reversed at resistance" className="rounded-sm font-mono text-xs h-8" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost" className="rounded-sm font-mono text-xs">Cancel</Button></DialogClose>
          <Button onClick={handleAdd} disabled={add.isPending || !symbol || !kind || !description} className="rounded-sm font-mono text-xs">Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Plus({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12h14" /><path d="M12 5v14" />
    </svg>
  );
}

const KIND_COLORS: Record<string, string> = {
  failed_setup:       "text-destructive",
  successful_setup:   "text-primary",
  regime_transition:  "text-blue-400",
  session_behavior:   "text-yellow-400",
  volatility_behavior: "text-orange-400",
};

function MarketMemoryPanel() {
  const [filterSymbol, setFilterSymbol] = useState("");
  const { data: entries = [], isLoading } = useListMarketMemory(
    { symbol: filterSymbol || undefined },
    { query: { refetchInterval: POLL_MS } as any },
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          value={filterSymbol}
          onChange={(e) => setFilterSymbol(e.target.value.toUpperCase())}
          placeholder="Filter by symbol (e.g. XAUUSD)"
          className="rounded-sm font-mono text-xs h-7 w-48"
        />
        <AddMemoryDialog />
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground font-mono">Loading…</p>
      ) : (entries as MarketMemoryEntry[]).length === 0 ? (
        <p className="text-xs text-muted-foreground font-mono">No market memory entries yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {(entries as MarketMemoryEntry[]).map((e) => (
            <div key={e.id} className="border border-border rounded-sm p-3 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs font-bold">{e.symbol}</span>
                <span className={`font-mono text-[10px] uppercase tracking-wide ${KIND_COLORS[e.kind] ?? ""}`}>
                  {e.kind.replace(/_/g, " ")}
                </span>
                {e.confidence != null && (
                  <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">
                    {(e.confidence * 100).toFixed(0)}% confidence
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                  {new Date(e.recordedAt).toLocaleString()}
                </span>
              </div>
              <p className="text-xs font-mono text-muted-foreground">{e.description}</p>
              {e.outcome && <p className="text-[10px] font-mono text-primary">Outcome: {e.outcome}</p>}
              {e.expiresAt && <p className="text-[10px] font-mono text-muted-foreground">Expires: {new Date(e.expiresAt).toLocaleDateString()}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminInferenceGateway() {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" /> Inference Gateway
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Control global inference switches, monitor the opportunity state machine, and manage runtime market memory.
        </p>
      </div>

      <div className="flex-1 p-8">
        <Tabs defaultValue="controls">
          <TabsList className="h-auto flex-wrap gap-1">
            <TabsTrigger value="controls" className="text-xs font-mono gap-1">
              <Brain className="w-3 h-3" /> Controls
            </TabsTrigger>
            <TabsTrigger value="opportunities" className="text-xs font-mono gap-1">
              <Target className="w-3 h-3" /> Opportunities
            </TabsTrigger>
            <TabsTrigger value="memory" className="text-xs font-mono gap-1">
              <BookOpen className="w-3 h-3" /> Market Memory
            </TabsTrigger>
          </TabsList>

          <TabsContent value="controls" className="mt-6">
            <InferenceControlsPanel />
          </TabsContent>

          <TabsContent value="opportunities" className="mt-6">
            <OpportunitiesPanel />
          </TabsContent>

          <TabsContent value="memory" className="mt-6">
            <MarketMemoryPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
