import { useState } from "react";
import { OpsShell } from "@/components/ops/ops-shell";
import { ResearchLabUnavailable, isResearchLabUnavailable } from "@/components/research-lab/unavailable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useListResearchLabExperiments,
  useGetResearchLabExperiment,
  useGetResearchLabExperimentLineage,
  useGetResearchLabExperimentHistory,
} from "@workspace/api-client-react";
import { FlaskConical, GitBranch, History, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function timeAgo(v: string | null | undefined) {
  if (!v) return "—";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

function ExperimentDetail({ id }: { id: string }) {
  const detail = useGetResearchLabExperiment(id, { query: { refetchInterval: 15_000 } as any });
  const lineage = useGetResearchLabExperimentLineage(id, { query: { refetchInterval: 30_000 } as any });
  const history = useGetResearchLabExperimentHistory(id, { query: { refetchInterval: 30_000 } as any });

  if (detail.error && isResearchLabUnavailable(detail.error)) return <ResearchLabUnavailable label="experiment detail" />;

  const experiment = (detail.data as { experiment?: Record<string, unknown> } | undefined)?.experiment;
  const lineageData = (lineage.data as { lineage?: unknown } | undefined)?.lineage;
  const historyItems = ((history.data as { history?: unknown[] } | undefined)?.history ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="space-y-4">
      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
            <FlaskConical className="w-4 h-4 text-cyan-400" /> Experiment {id}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <pre className="text-xs font-mono text-cyan-100/70 whitespace-pre-wrap break-all">
            {experiment ? JSON.stringify(experiment, null, 2) : "—"}
          </pre>
        </CardContent>
      </Card>

      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
            <GitBranch className="w-4 h-4 text-cyan-400" /> Lineage
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {lineage.error && isResearchLabUnavailable(lineage.error) ? (
            <ResearchLabUnavailable label="lineage" />
          ) : (
            <pre className="text-xs font-mono text-cyan-100/70 whitespace-pre-wrap break-all">
              {lineageData ? JSON.stringify(lineageData, null, 2) : "—"}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
            <History className="w-4 h-4 text-cyan-400" /> History
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {history.error && isResearchLabUnavailable(history.error) ? (
            <ResearchLabUnavailable label="history" />
          ) : historyItems.length === 0 ? (
            <div className="text-cyan-500/50 text-xs font-mono uppercase tracking-wider">[ No history recorded ]</div>
          ) : (
            <ul className="space-y-2">
              {historyItems.map((h, i) => (
                <li key={i} className="text-xs font-mono text-cyan-100/70">{JSON.stringify(h)}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminResearchLabExperiments() {
  const { data, error, isLoading } = useListResearchLabExperiments(undefined, { query: { refetchInterval: 20_000 } as any });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const experiments = ((data as { experiments?: unknown[] } | undefined)?.experiments ?? []) as Array<Record<string, unknown>>;

  return (
    <OpsShell title="Research Lab — Experiments" description="Experiment tracking, lineage, and history proxied from signalium-trainer.">
      {isLoading ? (
        <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING EXPERIMENTS... ]</div>
      ) : error && isResearchLabUnavailable(error) ? (
        <ResearchLabUnavailable />
      ) : selectedId ? (
        <div className="space-y-3">
          <button
            onClick={() => setSelectedId(null)}
            className="text-xs font-mono uppercase tracking-wider text-cyan-400 hover:text-cyan-300"
          >
            ← Back to list
          </button>
          <ExperimentDetail id={selectedId} />
        </div>
      ) : experiments.length === 0 ? (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-12 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">
            [ No experiments recorded yet ]
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {experiments.map((exp) => (
            <Card
              key={exp.id as string}
              className="border-cyan-900/40 bg-card/50 backdrop-blur cursor-pointer hover:border-cyan-700/60 transition-colors"
              onClick={() => setSelectedId(exp.id as string)}
            >
              <CardContent className="py-4 px-5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono font-bold text-sm text-cyan-50 truncate">{(exp.name as string) ?? (exp.id as string)}</div>
                  <div className="text-[10px] font-mono text-cyan-500/70 uppercase tracking-wider mt-0.5">{timeAgo(exp.createdAt as string)}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {exp.status ? <Badge className="text-[10px] font-mono uppercase">{exp.status as string}</Badge> : null}
                  <ChevronRight className="w-4 h-4 text-cyan-500/50" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </OpsShell>
  );
}
