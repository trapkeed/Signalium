/**
 * S26 — Scalability, High Availability & Disaster Recovery admin dashboard.
 *
 * Restricted to admin-level accounts (admin / super_admin) — same gating
 * pattern as ops-dashboard.tsx. Covers backups, the durable job queue,
 * circuit breakers, secret/key rotation, audit-log retention, and
 * config export/restore. Rollback/rolling-deploy itself is a Replit
 * platform feature (deployments + checkpoints) — not duplicated here; see
 * docs/DISASTER_RECOVERY.md.
 */
import { useState } from "react";
import { useUser } from "@/hooks/use-auth";
import {
  useGetResilienceBackups,
  usePostResilienceBackupsRun,
  usePostResilienceBackupsIdValidate,
  useGetResilienceBackupsIdRestorePlan,
  useGetResilienceQueueStats,
  useGetResilienceQueueDeadLetter,
  usePostResilienceQueueIdRequeue,
  useGetResilienceCircuitBreakers,
  useGetResilienceSecretRotation,
  usePostResilienceSecretRotationSecretNameMarkRotated,
  useGetResilienceAuditRetention,
  useGetResilienceConfigExport,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldAlert, DatabaseBackup, ListTodo, Radio, KeyRound, ScrollText, FileJson, RefreshCw, CircleCheck, CircleX } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function timeAgo(v: string | null | undefined) {
  if (!v) return "—";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return String(v); }
}

function SectionCard({ title, icon: Icon, action, children }: { title: string; icon: React.ElementType; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-border/50 flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2 uppercase tracking-wider">
          <Icon className="w-4 h-4 text-primary" />
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="pt-4">{children}</CardContent>
    </Card>
  );
}

function useIsAdminLevel(): boolean {
  const { user } = useUser();
  const role = user?.role;
  return role === "admin" || role === "super_admin";
}

function BackupsSection() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data, isLoading, refetch } = useGetResilienceBackups();
  const run = usePostResilienceBackupsRun();
  const validate = usePostResilienceBackupsIdValidate();
  const { data: plan, refetch: refetchPlan } = useGetResilienceBackupsIdRestorePlan(selectedId ?? 0, { query: { enabled: false, queryKey: ["resilience-restore-plan", selectedId] } });
  const backups = ((data as any)?.backups ?? []) as any[];

  return (
    <SectionCard
      title="Database Backups"
      icon={DatabaseBackup}
      action={
        <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate(undefined, { onSuccess: () => refetch() })}>
          {run.isPending ? "Running…" : "Run backup now"}
        </Button>
      }
    >
      <p className="text-xs text-muted-foreground mb-3">
        Portable, checksummed pg_dump snapshots stored in object storage — complements your database provider's point-in-time restore with an independent backup you control. See the DR runbook for full restore steps.
      </p>
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      <div className="space-y-1.5">
        {backups.length === 0 && !isLoading && <div className="text-sm text-muted-foreground">No backups yet.</div>}
        {backups.slice(0, 8).map((b) => (
          <div key={b.id} className="flex items-center justify-between text-sm gap-2 p-2 rounded-md bg-background/60 border border-border/50">
            <div className="truncate">
              <span className="font-mono">#{b.id}</span>{" "}
              <span className="text-muted-foreground">{b.backupType}</span>{" "}
              <span className="text-muted-foreground">· {timeAgo(b.startedAt)}</span>
              {b.sizeBytes && <span className="text-muted-foreground"> · {(b.sizeBytes / 1024 / 1024).toFixed(1)}MB</span>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Badge variant={b.status === "completed" || b.status === "validated" ? "secondary" : b.status === "failed" || b.status === "validation_failed" ? "destructive" : "outline"}>
                {b.status}
              </Badge>
              <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={validate.isPending} onClick={() => validate.mutate({ id: b.id }, { onSuccess: () => refetch() })}>
                Validate
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setSelectedId(b.id); setTimeout(() => refetchPlan(), 0); }}>
                Restore plan
              </Button>
            </div>
          </div>
        ))}
      </div>
      {plan && selectedId && (
        <div className="mt-3 p-3 rounded-md bg-background/80 border border-border/50 text-xs space-y-1">
          <div className="font-semibold mb-1">Restore plan — backup #{selectedId}</div>
          {((plan as any).steps ?? []).map((s: string, i: number) => <div key={i} className="text-muted-foreground">{s}</div>)}
        </div>
      )}
    </SectionCard>
  );
}

function JobQueueSection() {
  const { data: stats } = useGetResilienceQueueStats();
  const { data: deadLetter, refetch: refetchDl } = useGetResilienceQueueDeadLetter();
  const requeue = usePostResilienceQueueIdRequeue();
  const statRows = ((stats as any)?.stats ?? []) as any[];
  const jobs = ((deadLetter as any)?.jobs ?? []) as any[];

  return (
    <SectionCard title="Durable Job Queue" icon={ListTodo}>
      <p className="text-xs text-muted-foreground mb-3">DB-backed queue with priority ordering, exponential-backoff retry, and dead-letter after exhausted attempts.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        {statRows.length === 0 && <div className="text-sm text-muted-foreground col-span-3">No jobs enqueued yet.</div>}
        {statRows.map((s: any, i: number) => (
          <div key={i} className="p-2 rounded-md bg-background/60 border border-border/50 text-xs">
            <div className="text-muted-foreground truncate">{s.queue_name} · {s.status}</div>
            <div className="font-mono font-bold">{s.count}</div>
          </div>
        ))}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Dead letter</div>
      <div className="space-y-1.5">
        {jobs.length === 0 && <div className="text-sm text-muted-foreground">None — nothing has exhausted its retries.</div>}
        {jobs.map((j: any) => (
          <div key={j.id} className="flex items-center justify-between text-sm gap-2 p-2 rounded-md bg-background/60 border border-border/50">
            <div className="truncate text-muted-foreground">#{j.id} {j.queueName} — {j.lastError}</div>
            <Button size="sm" variant="ghost" className="h-6 text-xs shrink-0" disabled={requeue.isPending} onClick={() => requeue.mutate({ id: j.id }, { onSuccess: () => refetchDl() })}>
              Requeue
            </Button>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function CircuitBreakersSection() {
  const { data } = useGetResilienceCircuitBreakers();
  const breakers = ((data as any)?.breakers ?? []) as any[];
  return (
    <SectionCard title="Circuit Breakers" icon={Radio}>
      <p className="text-xs text-muted-foreground mb-3">Fail-fast + graceful degradation for outbound dependencies (e.g. the QDE trainer).</p>
      <div className="space-y-1.5">
        {breakers.length === 0 && <div className="text-sm text-muted-foreground">No breaker has been exercised yet.</div>}
        {breakers.map((b: any) => (
          <div key={b.name} className="flex items-center justify-between text-sm p-2 rounded-md bg-background/60 border border-border/50">
            <span className="truncate">{b.name}</span>
            <Badge variant={b.state === "closed" ? "secondary" : b.state === "open" ? "destructive" : "outline"}>{b.state}</Badge>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function SecretRotationSection() {
  const { data, refetch } = useGetResilienceSecretRotation();
  const markRotated = usePostResilienceSecretRotationSecretNameMarkRotated();
  const secrets = ((data as any)?.secrets ?? []) as any[];
  return (
    <SectionCard title="Secret & Key Rotation" icon={KeyRound}>
      <p className="text-xs text-muted-foreground mb-3">
        Tracks due-dates for third-party secrets we can't rotate programmatically; the SSO signing key rotates for real from the SSO panel.
      </p>
      <div className="space-y-1.5">
        {secrets.map((s: any) => (
          <div key={s.secretName} className="flex items-center justify-between text-sm gap-2 p-2 rounded-md bg-background/60 border border-border/50">
            <div className="truncate">
              <span className="font-mono">{s.secretName}</span>{" "}
              <span className="text-muted-foreground">· every {s.rotationIntervalDays}d</span>{" "}
              <span className="text-muted-foreground">· last {timeAgo(s.lastRotatedAt)}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Badge variant={s.status === "overdue" ? "destructive" : s.status === "due_soon" ? "outline" : "secondary"}>
                {s.status.replace("_", " ")}
              </Badge>
              <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={markRotated.isPending} onClick={() => markRotated.mutate({ secretName: s.secretName }, { onSuccess: () => refetch() })}>
                Mark rotated
              </Button>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function AuditRetentionSection() {
  const { data } = useGetResilienceAuditRetention();
  const info = data as any;
  return (
    <SectionCard title="Audit Log Retention" icon={ScrollText}>
      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 rounded-md bg-background/60 border border-border/50">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Retention window</div>
          <div className="text-xl font-mono font-bold">{info?.retentionDays ?? "—"}d</div>
        </div>
        <div className="p-3 rounded-md bg-background/60 border border-border/50">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total rows</div>
          <div className="text-xl font-mono font-bold">{info?.totalRows ?? "—"}</div>
        </div>
      </div>
      <div className="text-xs text-muted-foreground mt-2">Oldest entry: {timeAgo(info?.oldestEntryAt)}</div>
    </SectionCard>
  );
}

function ConfigExportSection() {
  const { refetch, isFetching } = useGetResilienceConfigExport({ query: { enabled: false, queryKey: ["resilience-config-export"] } });

  async function handleExport() {
    const result = await refetch();
    if (!result.data) return;
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `signalium-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <SectionCard title="Config Export / Restore" icon={FileJson}>
      <p className="text-xs text-muted-foreground mb-3">
        Exports platform configuration (feature flags, symbol registry, plans, brokers, data providers) as a portable JSON snapshot — for environment recreation, not user data restore.
      </p>
      <Button size="sm" variant="outline" disabled={isFetching} onClick={handleExport}>
        {isFetching ? "Exporting…" : "Download config snapshot"}
      </Button>
    </SectionCard>
  );
}

export default function AdminResilienceDashboard() {
  const isAdminLevel = useIsAdminLevel();

  if (!isAdminLevel) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center">
        <ShieldAlert className="w-10 h-10 text-destructive mx-auto mb-3" />
        <h1 className="text-lg font-semibold mb-1">Access restricted</h1>
        <p className="text-sm text-muted-foreground">
          The Resilience & Disaster Recovery dashboard is only available to Admin and Super Admin accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Resilience & Disaster Recovery</h1>
        <p className="text-sm text-muted-foreground">Backups, durable job queue, circuit breakers, secret rotation, audit retention, and config export.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BackupsSection />
        <JobQueueSection />
        <CircuitBreakersSection />
        <SecretRotationSection />
        <AuditRetentionSection />
        <ConfigExportSection />
      </div>
    </div>
  );
}
