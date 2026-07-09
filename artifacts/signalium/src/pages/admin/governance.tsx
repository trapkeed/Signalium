/**
 * S27 — Deployment Governance Visibility.
 *
 * Read-only institutional summary of the active QDE deployment: version,
 * status, certification status, health score, validation score, shadow
 * testing status, deployment history, and rollback history.
 *
 * Backend enforces the actual visibility tier (see routes/governance.ts):
 *   - SuperAdmin / Admin -> "full" (complete history, raw scores)
 *   - Founder            -> "strategic" (bucketed scores, short history)
 *   - Everyone else      -> 403 (this page renders a restricted-access card)
 *
 * This page never fetches or renders experiments, datasets, feature
 * engineering, training runs, deployment approvals, or research findings —
 * those live under Research Lab, gated to research roles.
 */
import { OpsShell } from "@/components/ops/ops-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useGetGovernanceOverview } from "@workspace/api-client-react";
import { ShieldCheck, Layers, HeartPulse, BadgeCheck, Radio, History, RotateCcw, Lock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function timeAgo(v: string | null | undefined) {
  if (!v) return "—";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return String(v); }
}

function statusTone(status: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  const s = (status ?? "").toLowerCase();
  if (["active", "healthy", "certified", "passed", "completed", "promoted"].includes(s)) return "default";
  if (["failed", "critical", "rejected", "rollback_triggered", "rolled_back"].includes(s)) return "destructive";
  if (!s) return "outline";
  return "secondary";
}

function StatTile({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: React.ReactNode; tone?: "default" | "secondary" | "destructive" | "outline" }) {
  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardContent className="py-4 px-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </div>
        {typeof value === "string" || value === null ? (
          <Badge variant={tone ?? statusTone(value as string)} className="text-sm font-mono">
            {value ?? "—"}
          </Badge>
        ) : (
          value
        )}
      </CardContent>
    </Card>
  );
}

function RestrictedCard({ status }: { status?: number }) {
  const copy =
    status === 401
      ? "Your session has expired — please sign in again to view deployment governance."
      : status === 503
        ? "Deployment governance data is temporarily unavailable — the trainer connection could not be reached. Try again shortly."
        : status === 403
          ? "Deployment governance visibility is limited to Admin, Super Admin, and Founder accounts."
          : "Deployment governance data could not be loaded. Please try again.";
  return (
    <Card className="border-border/60 bg-card/50 backdrop-blur">
      <CardContent className="py-16 text-center">
        <Lock className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{copy}</p>
      </CardContent>
    </Card>
  );
}

interface GovernanceOverview {
  tier: "full" | "strategic";
  activeVersion: string | null;
  deploymentStatus: string | null;
  certificationStatus: string | null;
  healthScore: number | string | null;
  validationScore: number | string | null;
  shadowTestingStatus: string | null;
  researchLabConfigured: boolean;
  deploymentHistory: Array<Record<string, unknown>>;
  rollbackHistory: Array<Record<string, unknown>>;
}

export default function AdminGovernance() {
  const { data, error, isLoading } = useGetGovernanceOverview({ query: { refetchInterval: 30_000 } as any });
  const overview = data as GovernanceOverview | undefined;
  const errorStatus = (error as { status?: number } | undefined)?.status;

  return (
    <OpsShell
      title="Deployment Governance"
      description="Institutional visibility into the active QDE deployment — version, certification, and health"
    >
      {isLoading ? (
        <div className="text-muted-foreground text-sm py-12 text-center animate-pulse">Loading governance summary…</div>
      ) : !overview ? (
        <RestrictedCard status={errorStatus} />
      ) : (
        <div className="space-y-6">
          {overview.tier === "strategic" && (
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-mono">
              Strategic view — condensed for Founder visibility
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatTile icon={Layers} label="Active QDE Version" value={overview.activeVersion ?? "—"} tone="outline" />
            <StatTile icon={Radio} label="Deployment Status" value={overview.deploymentStatus} />
            <StatTile icon={BadgeCheck} label="Certification Status" value={overview.certificationStatus} />
            <StatTile
              icon={HeartPulse}
              label="Health Score"
              value={typeof overview.healthScore === "number" ? `${overview.healthScore}/100` : overview.healthScore}
              tone={typeof overview.healthScore === "string" ? statusTone(overview.healthScore) : undefined}
            />
            <StatTile
              icon={ShieldCheck}
              label="Validation Score"
              value={typeof overview.validationScore === "number" ? `${overview.validationScore}/100` : overview.validationScore}
              tone={typeof overview.validationScore === "string" ? statusTone(overview.validationScore) : undefined}
            />
            <StatTile icon={Radio} label="Shadow Testing" value={overview.shadowTestingStatus} />
          </div>

          {!overview.researchLabConfigured && (
            <p className="text-[11px] font-mono text-muted-foreground/60 uppercase tracking-wider">
              [ Certification / validation / shadow-testing signals unavailable — signalium-trainer Research Lab is not configured ]
            </p>
          )}

          <Card className="bg-card/50 backdrop-blur">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm flex items-center gap-2 uppercase tracking-wider">
                <History className="w-4 h-4 text-primary" />
                Deployment History
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {overview.deploymentHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No deployments recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {overview.deploymentHistory.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-2 border-b border-border/30 last:border-0">
                      <span className="font-mono">{String(d.version ?? "—")}</span>
                      <Badge variant={statusTone(d.status as string)}>{String(d.status ?? "—")}</Badge>
                      <span className="text-muted-foreground text-xs">{timeAgo(d.activatedAt as string | null)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm flex items-center gap-2 uppercase tracking-wider">
                <RotateCcw className="w-4 h-4 text-primary" />
                Rollback History
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {overview.rollbackHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No rollbacks recorded.</p>
              ) : (
                <div className="space-y-2">
                  {overview.rollbackHistory.map((r, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-2 border-b border-border/30 last:border-0">
                      <span className="font-mono">{String(r.version ?? "—")}</span>
                      {"message" in r && r.message ? (
                        <span className="text-muted-foreground text-xs truncate max-w-[50%]">{String(r.message)}</span>
                      ) : null}
                      <span className="text-muted-foreground text-xs">{timeAgo(r.occurredAt as string | null)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </OpsShell>
  );
}
