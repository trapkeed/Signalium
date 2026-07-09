import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
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

  if (isLoading) return <div className="text-muted-foreground text-sm p-6">Loading…</div>;

  const active = (data as ActiveData | undefined);
  const deployment = active?.deployment as DeploymentRow | null | undefined;
  const inMemoryVersion = active?.inMemoryVersion;
  const synchronized = active?.synchronized;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {deployment ? (
            <>
              <StatusBadge status={deployment.status ?? "pending"} />
              <span className="font-semibold text-lg">{deployment.version}</span>
              {synchronized === false && (
                <span className="text-xs text-red-400 border border-red-400/30 rounded px-2 py-0.5">DB/memory out of sync</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">No active deployment</span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => pollMutation.mutate()} disabled={pollMutation.isPending}>
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

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                Integrity Verification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                {deployment.integrityVerified ? (
                  <><CheckCircle2 className="w-4 h-4 text-emerald-400" /><span className="text-emerald-400">SHA256 verified</span></>
                ) : (
                  <><AlertTriangle className="w-4 h-4 text-yellow-400" /><span className="text-yellow-400">Not yet verified</span></>
                )}
              </div>
              <div className="space-y-2">
                <HashValue label="Artifact Hash" value={deployment.artifactHash as string | null} />
                <HashValue label="Manifest Hash" value={deployment.manifestHash as string | null} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Layers className="w-4 h-4 text-muted-foreground" />
                Provenance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Deployment ID</div>
                  <code className="font-mono text-xs">{deployment.deploymentId}</code>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Trainer URL</div>
                  <code className="font-mono text-xs truncate block">{(deployment.trainerUrl as string | null) ?? "—"}</code>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">In-memory version</div>
                  <code className="font-mono text-xs">{inMemoryVersion ?? "none"}</code>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Local cache</div>
                  <code className="font-mono text-xs truncate block">{(deployment.localCachePath as string | null) ?? "—"}</code>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Server className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No deployment is currently active.</p>
            <p className="text-xs text-muted-foreground mt-1">Click "Poll Trainer" to detect a new deployment.</p>
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

  if (isLoading) return <div className="text-muted-foreground text-sm p-6">Loading…</div>;

  if (deployments.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground text-sm">No deployments recorded yet.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {deployments.map((d) => (
        <Card key={d.id} className={d.status === "active" ? "border-emerald-500/30 bg-emerald-500/5" : ""}>
          <CardContent className="py-4 px-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <StatusBadge status={d.status ?? "pending"} />
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{d.version}</div>
                  {d.featureVersion && (
                    <div className="text-xs text-muted-foreground">Feature: {d.featureVersion as string}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                {d.warmupLatencyMs != null && (
                  <span className="flex items-center gap-1">
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

  if (isLoading) return <div className="text-muted-foreground text-sm p-6">Loading…</div>;
  if (!latest) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground text-sm">
          No health data collected yet. Samples flush every 5 minutes during active operation.
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
        <div className="text-xs text-muted-foreground mb-3">Latest snapshot — {timeAgo(latest.recordedAt)}</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-yellow-400">
              <AlertTriangle className="w-4 h-4" />Active Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {alerts.map((a, i) => (
                <li key={i} className="text-sm text-yellow-300 flex items-start gap-2">
                  <span className="text-yellow-500 mt-0.5">•</span>{a}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {health.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Health History</CardTitle>
            <CardDescription>Last {health.length} snapshots</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4">Time</th>
                    <th className="text-right pr-4">P50</th>
                    <th className="text-right pr-4">P95</th>
                    <th className="text-right pr-4">Errors</th>
                    <th className="text-right pr-4">Calls</th>
                    <th className="text-right">Memory</th>
                  </tr>
                </thead>
                <tbody>
                  {health.map((h) => (
                    <tr key={h.id} className="border-b border-border/50">
                      <td className="py-2 pr-4 text-muted-foreground">{timeAgo(h.recordedAt)}</td>
                      <td className="text-right pr-4">{fmtMs(h.latencyP50Ms)}</td>
                      <td className="text-right pr-4">{fmtMs(h.latencyP95Ms)}</td>
                      <td className="text-right pr-4">{fmtPct(h.errorRate)}</td>
                      <td className="text-right pr-4">{h.sampleCount ?? 0}</td>
                      <td className="text-right">{h.memoryUsageMb != null ? `${(h.memoryUsageMb as number).toFixed(0)}MB` : "—"}</td>
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
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground text-sm">
          No active deployment. Activate a deployment to view its lifecycle events.
        </CardContent>
      </Card>
    );
  }

  return <DeploymentEventsList deploymentId={activeId} />;
}

function DeploymentEventsList({ deploymentId }: { deploymentId: number }) {
  const { data, isLoading } = useGetQdeAdminDeploymentsIdEvents(deploymentId);
  const events = ((data as EventData | undefined)?.events ?? []) as EventRow[];

  if (isLoading) return <div className="text-muted-foreground text-sm p-6">Loading…</div>;
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground text-sm">
          No lifecycle events recorded for this deployment yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-0">
      {events.map((e, idx) => (
        <div key={e.id} className="flex gap-3 text-sm">
          <div className="flex flex-col items-center pt-1">
            <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
            {idx < events.length - 1 && <div className="w-px flex-1 bg-border/50 mt-1" />}
          </div>
          <div className="pb-4 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium capitalize">{(e.eventType ?? "").replace(/_/g, " ")}</span>
              <span className="text-xs text-muted-foreground">{timeAgo(e.occurredAt)}</span>
            </div>
            {e.message && <p className="text-muted-foreground text-xs mt-0.5">{e.message as string}</p>}
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          QDE Runtime Health (24h)
        </CardTitle>
        <CardDescription>Live signals derived from opportunity and trade-timeline data.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="text-xl font-bold">{health.tradeGenerationFrequencyPerDay ?? 0}</div>
            <div className="text-xs text-muted-foreground">Opportunities / day</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="text-xl font-bold">{acceptancePct}</div>
            <div className="text-xs text-muted-foreground">Acceptance rate</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="text-xl font-bold">{avgConfidencePct}</div>
            <div className="text-xs text-muted-foreground">Avg. confidence</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="text-xl font-bold">{avgHolding}</div>
            <div className="text-xs text-muted-foreground">Avg. holding time</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="text-xl font-bold">
              {health.activeTraders?.autonomous ?? 0} / {health.activeTraders?.manual ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">Autonomous / Manual traders</div>
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
          queryClient.invalidateQueries({ queryKey: getGetOperationalDeploymentsVersionsQueryKey() });
        },
        onError: () => toast({ title: "Failed to record version", variant: "destructive" }),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Record a Deployment</CardTitle>
        <CardDescription>Display-only reference for the rollback history below. Does not trigger any action.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col md:flex-row gap-3 md:items-end">
        <div className="space-y-1.5 w-full md:w-40">
          <Label className="text-xs">Service</Label>
          <Select value={service} onValueChange={setService}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="frontend">Frontend</SelectItem>
              <SelectItem value="backend">Backend / API</SelectItem>
              <SelectItem value="trainer">Trainer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 w-full md:w-40">
          <Label className="text-xs">Version</Label>
          <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1.4.2" />
        </div>
        <div className="space-y-1.5 flex-1">
          <Label className="text-xs">Notes (optional)</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What changed?" />
        </div>
        <Button onClick={handleSubmit} disabled={record.isPending}>Record</Button>
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
            <Card key={svc}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="w-4 h-4 text-primary" />
                  {SERVICE_LABELS[svc]}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {row ? (
                  <>
                    <div className="text-xl font-bold">{row.version}</div>
                    {row.gitCommitHash && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <Hash className="w-3 h-3" />{row.gitCommitHash.slice(0, 7)}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">{timeAgo(row.deployedAt)}</div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">No version recorded</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Deployment History</CardTitle>
          <CardDescription>Reference for manual rollback — most recent first.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-muted-foreground text-sm py-6">Loading…</div>
          ) : history.length === 0 ? (
            <div className="text-muted-foreground text-sm py-6 text-center">No deployments recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground text-xs border-b border-border/50">
                    <th className="pb-2 pr-4">Service</th>
                    <th className="pb-2 pr-4">Version</th>
                    <th className="pb-2 pr-4">Commit</th>
                    <th className="pb-2 pr-4">Notes</th>
                    <th className="text-right pb-2">Deployed</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} className="border-b border-border/50">
                      <td className="py-2 pr-4">{SERVICE_LABELS[row.service ?? ""] ?? row.service}</td>
                      <td className="py-2 pr-4 font-medium">{row.version}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{row.gitCommitHash ? row.gitCommitHash.slice(0, 7) : "—"}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{row.notes ?? "—"}</td>
                      <td className="text-right py-2 text-muted-foreground">{timeAgo(row.deployedAt)}</td>
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
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Cpu className="w-6 h-6 text-primary" />
          QDE Deployments
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Monitor and manage QDE model deployments from signalium-trainer. Hot-swap with zero downtime.
        </p>
      </div>

      <Tabs defaultValue="active">
        <TabsList className="mb-6">
          <TabsTrigger value="active" className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" />Active
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />History
          </TabsTrigger>
          <TabsTrigger value="health" className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5" />Health
          </TabsTrigger>
          <TabsTrigger value="events" className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" />Events
          </TabsTrigger>
          <TabsTrigger value="versions" className="flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5" />Service Versions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active"><ActiveDeploymentTab /></TabsContent>
        <TabsContent value="history"><DeploymentHistoryTab /></TabsContent>
        <TabsContent value="health"><HealthMetricsTab /></TabsContent>
        <TabsContent value="events"><EventsLogTab /></TabsContent>
        <TabsContent value="versions"><ServiceVersionsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
