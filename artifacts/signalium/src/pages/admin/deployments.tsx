import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { OpsShell } from "@/components/ops/ops-shell";
import { useOpsRealtimeTypes } from "@/hooks/use-ops-realtime";
import {
  useGetQdeAdminDeployments,
  useGetQdeAdminDeploymentsActive,
  useGetQdeAdminDeploymentsHealthCurrent,
  useGetQdeAdminDeploymentsIdEvents,
  usePostQdeAdminDeploymentsPoll,
  useGetOperationalDeploymentsVersions,
  usePostOperationalDeploymentsVersions,
  useGetOperationalQdeRuntimeHealth,
  getGetOperationalDeploymentsVersionsQueryKey,
  getGetQdeAdminDeploymentsQueryKey,
  getGetQdeAdminDeploymentsActiveQueryKey,
  getGetQdeAdminDeploymentsHealthCurrentQueryKey,
  type GetQdeAdminDeployments200,
  type GetQdeAdminDeploymentsActive200,
  type GetQdeAdminDeploymentsHealthCurrent200,
  type GetQdeAdminDeploymentsIdEvents200,
  type GetOperationalDeploymentsVersions200,
  type QdeRuntimeHealth,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  Shield,
  Zap,
  RotateCcw,
  RefreshCw,
  Activity,
  Cpu,
  Server,
  AlertTriangle,
  Hash,
  Layers,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types inferred from API ──────────────────────────────────────────────────

type DeploymentList = NonNullable<GetQdeAdminDeployments200>;
type DeploymentRow = NonNullable<DeploymentList["deployments"]>[number];
type ActiveData = NonNullable<GetQdeAdminDeploymentsActive200>;
type HealthData = NonNullable<GetQdeAdminDeploymentsHealthCurrent200>;
type HealthRow = NonNullable<HealthData["health"]>[number];
type EventData = NonNullable<GetQdeAdminDeploymentsIdEvents200>;
type EventRow = NonNullable<EventData["events"]>[number];

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_META = {
  pending:     { label: "Pending",     color: "text-muted-foreground",     icon: Clock },
  downloading: { label: "Downloading", color: "text-blue-400",             icon: Download },
  verifying:   { label: "Verifying",   color: "text-yellow-400",           icon: Shield },
  warming:     { label: "Warming",     color: "text-orange-400",           icon: Zap },
  active:      { label: "Active",      color: "text-emerald-400",          icon: CheckCircle2 },
  retired:     { label: "Retired",     color: "text-muted-foreground",     icon: RotateCcw },
  failed:      { label: "Failed",      color: "text-red-400",              icon: XCircle },
} as const;

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status as keyof typeof STATUS_META] ?? STATUS_META.pending;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.color}`}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

function HashValue({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <Hash className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</div>
        <code className="text-xs text-foreground/80 font-mono break-all">{value}</code>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string | null | undefined; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value ?? "—"}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function timeAgo(val: string | null | undefined): string {
  if (!val) return "—";
  try { return formatDistanceToNow(new Date(val), { addSuffix: true }); } catch { return val; }
}

function fmtMs(val: number | null | undefined): string {
  return val != null ? `${val.toFixed(0)}ms` : "—";
}
function fmtPct(val: number | null | undefined): string {
  return val != null ? `${(val * 100).toFixed(2)}%` : "—";
}

// ─── Active Deployment Tab ────────────────────────────────────────────────────

function ActiveDeploymentTab() {
  const { data, isLoading, refetch } = useGetQdeAdminDeploymentsActive();
  const { toast } = useToast();
  const pollMutation = usePostQdeAdminDeploymentsPoll({
    mutation: {
      onSuccess: (d) => {
        toast({ title: d.changed ? "Hot-swap initiated" : "No update", description: d.message ?? "" });
        void refetch();
      },
      onError: () => toast({ title: "Poll failed", variant: "destructive" }),
    },
  });

  if (isLoading) return <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING DEPLOYMENT STATE... ]</div>;

  const active = (data as ActiveData | undefined);
  const deployment = active?.deployment as DeploymentRow | null | undefined;
  const inMemoryVersion = active?.inMemoryVersion;
  const synchronized = active?.synchronized;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {deployment ? (
            <>
              <StatusBadge status={deployment.status ?? "pending"} />
              <span className="font-mono font-bold text-lg text-cyan-50 uppercase tracking-wider">{deployment.version}</span>
              {synchronized === false && (
                <span className="text-[10px] font-mono text-red-400 border border-red-900/50 bg-red-950/20 rounded px-2 py-0.5 uppercase tracking-wider">DB/memory out of sync</span>
              )}
            </>
          ) : (
            <span className="text-cyan-500/50 font-mono text-xs uppercase tracking-wider">[ No active deployment ]</span>
          )}
        </div>
        <Button size="sm" variant="outline" className="w-full sm:w-auto border-cyan-900/50 text-cyan-50 hover:bg-cyan-900/20 bg-background/50" onClick={() => pollMutation.mutate()} disabled={pollMutation.isPending}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${pollMutation.isPending ? "animate-spin" : ""}`} />
          Poll Trainer
        </Button>
      </div>

      {deployment ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Version" value={deployment.version} />
            <MetricCard label="Feature Version" value={deployment.featureVersion ?? "—"} />
            <MetricCard label="Warm-up Latency" value={deployment.warmupLatencyMs != null ? fmtMs(deployment.warmupLatencyMs as number) : undefined} />
            <MetricCard label="Activated" value={timeAgo(deployment.activatedAt as string | null)} />
          </div>

          <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
            <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
              <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
                <Shield className="w-4 h-4 text-emerald-400" />
                Integrity Verification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="flex items-center gap-2 text-sm font-mono uppercase tracking-wider">
                {deployment.integrityVerified ? (
                  <><CheckCircle2 className="w-4 h-4 text-emerald-400" /><span className="text-emerald-400">SHA256 verified</span></>
                ) : (
                  <><AlertTriangle className="w-4 h-4 text-yellow-400" /><span className="text-yellow-400">Not yet verified</span></>
                )}
              </div>
              <div className="space-y-3">
                <HashValue label="Artifact Hash" value={deployment.artifactHash as string | null} />
                <HashValue label="Manifest Hash" value={deployment.manifestHash as string | null} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
            <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
              <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
                <Layers className="w-4 h-4 text-cyan-500/70" />
                Provenance
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-cyan-500/70 mb-1 font-mono">Deployment ID</div>
                  <code className="font-mono text-xs text-cyan-50">{deployment.deploymentId}</code>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-cyan-500/70 mb-1 font-mono">Trainer URL</div>
                  <code className="font-mono text-xs text-cyan-50 truncate block">{(deployment.trainerUrl as string | null) ?? "—"}</code>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-cyan-500/70 mb-1 font-mono">In-memory version</div>
                  <code className="font-mono text-xs text-cyan-50">{inMemoryVersion ?? "none"}</code>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-cyan-500/70 mb-1 font-mono">Local cache</div>
                  <code className="font-mono text-xs text-cyan-50 truncate block">{(deployment.localCachePath as string | null) ?? "—"}</code>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-12 text-center">
            <Server className="w-8 h-8 text-cyan-500/30 mx-auto mb-3" />
            <p className="text-[11px] uppercase tracking-wider font-mono text-cyan-500/50">[ No deployment is currently active ]</p>
            <p className="text-[10px] font-mono text-cyan-500/40 mt-1 uppercase">Click "Poll Trainer" to detect a new deployment.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Deployment History Tab ───────────────────────────────────────────────────

function DeploymentHistoryTab() {
  const { data, isLoading } = useGetQdeAdminDeployments();
  const deployments = ((data as DeploymentList | undefined)?.deployments ?? []) as DeploymentRow[];

  if (isLoading) return <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING HISTORY... ]</div>;

  if (deployments.length === 0) {
    return (
      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardContent className="py-12 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">[ No deployments recorded yet ]</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {deployments.map((d) => (
        <Card key={d.id} className={`border-cyan-900/40 bg-card/50 backdrop-blur ${d.status === "active" ? "border-emerald-900/40" : ""}`}>
          <CardContent className="py-4 px-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <StatusBadge status={d.status ?? "pending"} />
                <div className="min-w-0">
                  <div className="font-mono font-bold text-sm text-cyan-50 uppercase tracking-wider">{d.version}</div>
                  {d.featureVersion && (
                    <div className="text-[10px] font-mono text-cyan-500/70 uppercase tracking-wider mt-0.5">Feature: {d.featureVersion as string}</div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono uppercase tracking-wider text-cyan-100/60 shrink-0 justify-start sm:justify-end mt-2 sm:mt-0">
                {d.warmupLatencyMs != null && (
                  <span className="flex items-center gap-1.5 text-cyan-400">
                    <Zap className="w-3 h-3" />{fmtMs(d.warmupLatencyMs as number)}
                  </span>
                )}
                <span>{timeAgo(d.activatedAt as string | null)}</span>
                {d.failureReason && (
                  <span className="text-red-400 max-w-48 truncate">{d.failureReason as string}</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Health Metrics Tab ───────────────────────────────────────────────────────

function HealthMetricsTab() {
  const { data, isLoading } = useGetQdeAdminDeploymentsHealthCurrent();
  const health = ((data as HealthData | undefined)?.health ?? []) as HealthRow[];
  const latest = health[0];

  if (isLoading) return <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING HEALTH DATA... ]</div>;
  if (!latest) {
    return (
      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardContent className="py-12 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">
          [ No health data collected yet. Samples flush every 5 minutes during active operation. ]
        </CardContent>
      </Card>
    );
  }

  const confDist = latest.confidenceDistribution as { low?: number; medium?: number; high?: number } | null;
  const totalConf = (confDist?.low ?? 0) + (confDist?.medium ?? 0) + (confDist?.high ?? 0);
  const pct = (n: number | undefined) => totalConf > 0 ? `${(((n ?? 0) / totalConf) * 100).toFixed(0)}%` : "—";
  const alerts = (latest.alerts ?? []) as string[];

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-500/70 mb-3 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
          Latest snapshot — {timeAgo(latest.recordedAt)}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <MetricCard label="P50 Latency" value={fmtMs(latest.latencyP50Ms)} />
          <MetricCard label="P95 Latency" value={fmtMs(latest.latencyP95Ms)} />
          <MetricCard label="P99 Latency" value={fmtMs(latest.latencyP99Ms)} />
          <MetricCard label="Error Rate" value={fmtPct(latest.errorRate)} sub={`${latest.sampleCount ?? 0} samples`} />
          <MetricCard label="Throughput" value={latest.throughputPerMin != null ? `${(latest.throughputPerMin as number).toFixed(1)}/min` : undefined} />
          <MetricCard label="Memory" value={latest.memoryUsageMb != null ? `${(latest.memoryUsageMb as number).toFixed(0)} MB` : undefined} />
          <MetricCard label="Low Confidence" value={pct(confDist?.low)} sub={`${confDist?.low ?? 0} decisions`} />
          <MetricCard label="High Confidence" value={pct(confDist?.high)} sub={`${confDist?.high ?? 0} decisions`} />
        </div>
      </div>

      {alerts.length > 0 && (
        <Card className="border-yellow-900/40 bg-card/50 backdrop-blur">
          <CardHeader className="pb-3 border-b border-yellow-900/20 bg-muted/10">
            <CardTitle className="text-sm flex items-center gap-2 text-yellow-400 font-mono uppercase tracking-wider">
              <AlertTriangle className="w-4 h-4" />Active Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li key={i} className="text-xs font-mono uppercase tracking-wider text-yellow-300/80 flex items-start gap-2">
                  <span className="text-yellow-500 mt-0.5">•</span>{a}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {health.length > 1 && (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-cyan-50">Health History</CardTitle>
            <CardDescription className="text-[10px] font-mono text-cyan-500/70 mt-1 uppercase">Last {health.length} snapshots</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-cyan-900/30 text-[10px] uppercase tracking-wider text-cyan-100/50 bg-background/50">
                    <th className="text-left py-2.5 px-4 font-semibold">Time</th>
                    <th className="text-right py-2.5 px-4 font-semibold">P50</th>
                    <th className="text-right py-2.5 px-4 font-semibold">P95</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Errors</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Calls</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Memory</th>
                  </tr>
                </thead>
                <tbody className="text-[11px]">
                  {health.map((h) => (
                    <tr key={h.id} className="border-b border-cyan-900/10 hover:bg-cyan-950/20 transition-colors text-cyan-100">
                      <td className="py-2 px-4 text-cyan-500/70 whitespace-nowrap">{timeAgo(h.recordedAt)}</td>
                      <td className="text-right py-2 px-4">{fmtMs(h.latencyP50Ms)}</td>
                      <td className="text-right py-2 px-4">{fmtMs(h.latencyP95Ms)}</td>
                      <td className="text-right py-2 px-4">{fmtPct(h.errorRate)}</td>
                      <td className="text-right py-2 px-4">{h.sampleCount ?? 0}</td>
                      <td className="text-right py-2 px-4">{h.memoryUsageMb != null ? `${(h.memoryUsageMb as number).toFixed(0)}MB` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Events Log Tab ───────────────────────────────────────────────────────────

function EventsLogTab() {
  const { data: activeData } = useGetQdeAdminDeploymentsActive();
  const activeId = ((activeData as ActiveData | undefined)?.deployment as DeploymentRow | null | undefined)?.id;

  if (!activeId) {
    return (
      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardContent className="py-12 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">
          [ No active deployment. Activate a deployment to view its lifecycle events. ]
        </CardContent>
      </Card>
    );
  }

  return <DeploymentEventsList deploymentId={activeId} />;
}

function DeploymentEventsList({ deploymentId }: { deploymentId: number }) {
  const { data, isLoading } = useGetQdeAdminDeploymentsIdEvents(deploymentId);
  const events = ((data as EventData | undefined)?.events ?? []) as EventRow[];

  if (isLoading) return <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING EVENTS... ]</div>;
  if (events.length === 0) {
    return (
      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardContent className="py-12 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">
          [ No lifecycle events recorded for this deployment yet. ]
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-0 pl-2">
      {events.map((e, idx) => (
        <div key={e.id} className="flex gap-4 text-sm font-mono">
          <div className="flex flex-col items-center pt-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(34,211,238,0.8)] shrink-0" />
            {idx < events.length - 1 && <div className="w-px flex-1 bg-cyan-900/50 mt-1.5 mb-0.5" />}
          </div>
          <div className="pb-6 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-cyan-50 uppercase tracking-wider text-[11px]">{(e.eventType ?? "").replace(/_/g, " ")}</span>
              <span className="text-[10px] text-cyan-500/50 uppercase tracking-wider">{timeAgo(e.occurredAt)}</span>
            </div>
            {e.message && <p className="text-cyan-100/70 text-xs mt-1">{e.message as string}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Service Versions Tab ──────────────────────────────────────────────────────

type VersionsData = NonNullable<GetOperationalDeploymentsVersions200>;
type ServiceRow = NonNullable<VersionsData["history"]>[number];
type RuntimeHealthData = QdeRuntimeHealth;

const SERVICE_LABELS: Record<string, string> = {
  frontend: "Frontend",
  backend: "Backend / API",
  trainer: "Trainer",
};

function QdeRuntimeHealthCard() {
  const { data } = useGetOperationalQdeRuntimeHealth();
  const health = data as RuntimeHealthData | undefined;
  if (!health) return null;

  const acceptancePct = health.tradeAcceptanceRate != null ? `${(health.tradeAcceptanceRate * 100).toFixed(1)}%` : "—";
  const avgConfidencePct = health.avgConfidence != null ? `${(health.avgConfidence * 100).toFixed(0)}%` : "—";
  const avgHolding = health.avgHoldingDurationSeconds != null
    ? `${Math.round(health.avgHoldingDurationSeconds / 60)}m`
    : "—";

  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
        <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
          <Activity className="w-4 h-4 text-cyan-400" />
          QDE Runtime Health (24h)
        </CardTitle>
        <CardDescription className="text-[10px] font-mono text-cyan-500/70 mt-1 uppercase tracking-wider">Live signals derived from opportunity and trade-timeline data.</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="p-3 rounded-md bg-background/50 border border-cyan-900/30 shadow-inner">
            <div className="text-xl font-mono font-bold text-cyan-50">{health.tradeGenerationFrequencyPerDay ?? 0}</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-500/70 mt-1">Opp / day</div>
          </div>
          <div className="p-3 rounded-md bg-background/50 border border-cyan-900/30 shadow-inner">
            <div className="text-xl font-mono font-bold text-cyan-50">{acceptancePct}</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-500/70 mt-1">Acceptance</div>
          </div>
          <div className="p-3 rounded-md bg-background/50 border border-cyan-900/30 shadow-inner">
            <div className="text-xl font-mono font-bold text-cyan-50">{avgConfidencePct}</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-500/70 mt-1">Avg Conf</div>
          </div>
          <div className="p-3 rounded-md bg-background/50 border border-cyan-900/30 shadow-inner">
            <div className="text-xl font-mono font-bold text-cyan-50">{avgHolding}</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-500/70 mt-1">Avg Hold</div>
          </div>
          <div className="p-3 rounded-md bg-background/50 border border-cyan-900/30 shadow-inner">
            <div className="text-xl font-mono font-bold text-cyan-50">
              {health.activeTraders?.autonomous ?? 0} <span className="opacity-50 text-cyan-500">/</span> {health.activeTraders?.manual ?? 0}
            </div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-500/70 mt-1">Auto/Man Traders</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecordVersionForm() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [service, setService] = useState<string>("frontend");
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const record = usePostOperationalDeploymentsVersions();

  const handleSubmit = () => {
    if (!version.trim()) {
      toast({ title: "Version is required", variant: "destructive" });
      return;
    }
    record.mutate(
      { data: { service: service as "frontend" | "backend" | "trainer", version: version.trim(), notes: notes.trim() || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Deployment version recorded" });
          setVersion("");
          setNotes("");
          void queryClient.invalidateQueries({ queryKey: getGetOperationalDeploymentsVersionsQueryKey() });
        },
        onError: () => toast({ title: "Failed to record version", variant: "destructive" }),
      },
    );
  };

  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
        <CardTitle className="text-sm font-mono uppercase tracking-wider text-cyan-50">Record a Deployment</CardTitle>
        <CardDescription className="text-[10px] font-mono text-cyan-500/70 mt-1 uppercase tracking-wider">Display-only reference for the rollback history below.</CardDescription>
      </CardHeader>
      <CardContent className="pt-4 flex flex-col md:flex-row gap-3 md:items-end">
        <div className="space-y-1.5 w-full md:w-40">
          <Label className="text-[10px] font-mono uppercase tracking-wider text-cyan-500/70">Service</Label>
          <Select value={service} onValueChange={setService}>
            <SelectTrigger className="bg-background/50 border-cyan-900/30 text-cyan-50 font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="frontend">Frontend</SelectItem>
              <SelectItem value="backend">Backend / API</SelectItem>
              <SelectItem value="trainer">Trainer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 w-full md:w-40">
          <Label className="text-[10px] font-mono uppercase tracking-wider text-cyan-500/70">Version</Label>
          <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1.4.2" className="bg-background/50 border-cyan-900/30 text-cyan-50 placeholder:text-cyan-500/50 font-mono text-xs" />
        </div>
        <div className="space-y-1.5 flex-1">
          <Label className="text-[10px] font-mono uppercase tracking-wider text-cyan-500/70">Notes (optional)</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What changed?" className="bg-background/50 border-cyan-900/30 text-cyan-50 placeholder:text-cyan-500/50 font-mono text-xs" />
        </div>
        <Button onClick={handleSubmit} disabled={record.isPending} className="w-full md:w-auto bg-cyan-900 hover:bg-cyan-800 text-cyan-50 font-mono text-xs uppercase tracking-wider">Record</Button>
      </CardContent>
    </Card>
  );
}

function ServiceVersionsTab() {
  const { data, isLoading } = useGetOperationalDeploymentsVersions();
  const versions = data as VersionsData | undefined;
  const current = versions?.current;
  const history = (versions?.history ?? []) as ServiceRow[];

  return (
    <div className="space-y-4">
      <QdeRuntimeHealthCard />
      <RecordVersionForm />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(["frontend", "backend", "trainer"] as const).map((svc) => {
          const row = current?.[svc];
          return (
            <Card key={svc} className="border-cyan-900/40 bg-card/50 backdrop-blur">
              <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
                <CardTitle className="text-sm flex items-center gap-2 font-mono uppercase tracking-wider text-cyan-50">
                  <Server className="w-4 h-4 text-cyan-400" />
                  {SERVICE_LABELS[svc]}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {row ? (
                  <>
                    <div className="text-xl font-mono font-bold text-cyan-50 uppercase tracking-wider">{row.version}</div>
                    {row.gitCommitHash && (
                      <div className="text-[10px] font-mono text-cyan-500/70 flex items-center gap-1 mt-2 uppercase tracking-wider">
                        <Hash className="w-3 h-3 text-cyan-500/50" />{row.gitCommitHash.slice(0, 7)}
                      </div>
                    )}
                    <div className="text-[10px] font-mono text-cyan-500/50 mt-1 uppercase tracking-wider">{timeAgo(row.deployedAt)}</div>
                  </>
                ) : (
                  <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-500/50">[ No version recorded ]</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-cyan-50">Deployment History</CardTitle>
          <CardDescription className="text-[10px] font-mono text-cyan-500/70 mt-1 uppercase tracking-wider">Reference for manual rollback — most recent first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING HISTORY... ]</div>
          ) : history.length === 0 ? (
            <div className="text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider py-8 text-center">[ No deployments recorded yet ]</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-cyan-100/50 border-b border-cyan-900/30 bg-background/50">
                    <th className="py-2.5 px-4 font-semibold">Service</th>
                    <th className="py-2.5 px-4 font-semibold">Version</th>
                    <th className="py-2.5 px-4 font-semibold">Commit</th>
                    <th className="py-2.5 px-4 font-semibold">Notes</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Deployed</th>
                  </tr>
                </thead>
                <tbody className="text-[11px]">
                  {history.map((row) => (
                    <tr key={row.id} className="border-b border-cyan-900/10 hover:bg-cyan-950/20 transition-colors text-cyan-100">
                      <td className="py-2 px-4 uppercase tracking-wider text-cyan-500/70">{SERVICE_LABELS[row.service ?? ""] ?? row.service}</td>
                      <td className="py-2 px-4 font-bold text-cyan-50 uppercase tracking-wider">{row.version}</td>
                      <td className="py-2 px-4 text-cyan-500/50">{row.gitCommitHash ? row.gitCommitHash.slice(0, 7) : "—"}</td>
                      <td className="py-2 px-4 text-cyan-100/60 max-w-[200px] truncate" title={row.notes ?? ""}>{row.notes ?? "—"}</td>
                      <td className="text-right py-2 px-4 text-cyan-500/70 whitespace-nowrap">{timeAgo(row.deployedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminDeployments() {
  const queryClient = useQueryClient();
  useOpsRealtimeTypes(["deployment.event"], () => {
    void queryClient.invalidateQueries({ queryKey: getGetQdeAdminDeploymentsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetQdeAdminDeploymentsActiveQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetQdeAdminDeploymentsHealthCurrentQueryKey() });
    // Deployment id isn't known here, so match any /events query key by URL
    // prefix rather than guessing an id (invalidating id 0 would silently
    // never match a real deployment's events query).
    void queryClient.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("/api/qde/admin/deployments/") &&
        query.queryKey[0].endsWith("/events"),
    });
    void queryClient.invalidateQueries({ queryKey: getGetOperationalDeploymentsVersionsQueryKey() });
  });

  return (
    <OpsShell
      title="QDE Deployments"
      description="Monitor and manage QDE model deployments from signalium-trainer. Hot-swap with zero downtime."
    >
      <Tabs defaultValue="active" className="mt-4">
        <TabsList className="mb-6 bg-cyan-950/20 border border-cyan-900/30 p-1 flex-wrap h-auto w-full justify-start">
          <TabsTrigger value="active" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider data-[state=active]:bg-cyan-900/50 data-[state=active]:text-cyan-50">
            <Activity className="w-3.5 h-3.5" />Active
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider data-[state=active]:bg-cyan-900/50 data-[state=active]:text-cyan-50">
            <Layers className="w-3.5 h-3.5" />History
          </TabsTrigger>
          <TabsTrigger value="health" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider data-[state=active]:bg-cyan-900/50 data-[state=active]:text-cyan-50">
            <Cpu className="w-3.5 h-3.5" />Health
          </TabsTrigger>
          <TabsTrigger value="events" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider data-[state=active]:bg-cyan-900/50 data-[state=active]:text-cyan-50">
            <Activity className="w-3.5 h-3.5" />Events
          </TabsTrigger>
          <TabsTrigger value="versions" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider data-[state=active]:bg-cyan-900/50 data-[state=active]:text-cyan-50">
            <Server className="w-3.5 h-3.5" />Service Versions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active"><ActiveDeploymentTab /></TabsContent>
        <TabsContent value="history"><DeploymentHistoryTab /></TabsContent>
        <TabsContent value="health"><HealthMetricsTab /></TabsContent>
        <TabsContent value="events"><EventsLogTab /></TabsContent>
        <TabsContent value="versions"><ServiceVersionsTab /></TabsContent>
      </Tabs>
    </OpsShell>
  );
}
