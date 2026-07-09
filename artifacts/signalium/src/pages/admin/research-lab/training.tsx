import { OpsShell } from "@/components/ops/ops-shell";
import { ResearchLabUnavailable, isResearchLabUnavailable } from "@/components/research-lab/unavailable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useListResearchLabTrainingRuns,
  useGetResearchLabTrainingResourceUsage,
} from "@workspace/api-client-react";
import { Cpu, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function timeAgo(v: string | null | undefined) {
  if (!v) return "—";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

const STATUS_COLOR: Record<string, string> = {
  active: "bg-cyan-500/10 text-cyan-400",
  running: "bg-cyan-500/10 text-cyan-400",
  completed: "bg-emerald-500/10 text-emerald-400",
  failed: "bg-red-500/10 text-red-400",
};

function ResourceUsageCard() {
  const { data, error, isLoading } = useGetResearchLabTrainingResourceUsage({ query: { refetchInterval: 15_000 } as any });
  if (isLoading) return null;
  if (error && isResearchLabUnavailable(error)) return <ResearchLabUnavailable label="resource usage" />;
  const usage = (data as { usage?: Record<string, unknown> } | undefined)?.usage;
  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
        <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
          <Cpu className="w-4 h-4 text-cyan-400" /> Resource Usage
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <pre className="text-xs font-mono text-cyan-100/70 whitespace-pre-wrap break-all">
          {usage ? JSON.stringify(usage, null, 2) : "—"}
        </pre>
      </CardContent>
    </Card>
  );
}

export default function AdminResearchLabTraining() {
  const { data, error, isLoading } = useListResearchLabTrainingRuns(undefined, { query: { refetchInterval: 10_000 } as any });
  const runs = ((data as { runs?: unknown[] } | undefined)?.runs ?? []) as Array<Record<string, unknown>>;

  return (
    <OpsShell title="Research Lab — Training" description="Active, completed, and failed training runs proxied from signalium-trainer.">
      {isLoading ? (
        <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING TRAINING RUNS... ]</div>
      ) : error && isResearchLabUnavailable(error) ? (
        <ResearchLabUnavailable />
      ) : (
        <div className="space-y-4 sm:space-y-6">
          <ResourceUsageCard />
          {runs.length === 0 ? (
            <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
              <CardContent className="py-12 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">
                [ No training runs recorded yet ]
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <Card key={run.id as string} className="border-cyan-900/40 bg-card/50 backdrop-blur">
                  <CardContent className="py-4 px-5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-sm text-cyan-50 flex items-center gap-2">
                        <Activity className="w-3.5 h-3.5 text-cyan-400" />
                        {(run.name as string) ?? (run.id as string)}
                      </div>
                      <div className="text-[10px] font-mono text-cyan-500/70 uppercase tracking-wider mt-0.5">{timeAgo(run.startedAt as string ?? run.createdAt as string)}</div>
                    </div>
                    {run.status ? (
                      <Badge className={`${STATUS_COLOR[(run.status as string).toLowerCase()] ?? ""} text-[10px] font-mono uppercase shrink-0`}>
                        {run.status as string}
                      </Badge>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </OpsShell>
  );
}
