import { useState } from "react";
import { OpsShell } from "@/components/ops/ops-shell";
import { ResearchLabUnavailable, isResearchLabUnavailable } from "@/components/research-lab/unavailable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useListResearchLabShadowDeployments,
  useGetResearchLabShadowComparison,
  useGetResearchLabShadowAgreement,
  useGetResearchLabShadowRegimeComparison,
} from "@workspace/api-client-react";
import { Radar, Scale, LineChart, ChevronRight } from "lucide-react";

function ShadowDetail({ id }: { id: string }) {
  const comparison = useGetResearchLabShadowComparison(id, { query: { refetchInterval: 20_000 } as any });
  const agreement = useGetResearchLabShadowAgreement(id, { query: { refetchInterval: 20_000 } as any });
  const regimes = useGetResearchLabShadowRegimeComparison(id, { query: { refetchInterval: 20_000 } as any });

  return (
    <div className="space-y-4">
      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
            <Scale className="w-4 h-4 text-cyan-400" /> Challenger Comparison
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {comparison.error && isResearchLabUnavailable(comparison.error) ? <ResearchLabUnavailable label="comparison" /> : (
            <pre className="text-xs font-mono text-cyan-100/70 whitespace-pre-wrap break-all">
              {JSON.stringify((comparison.data as { comparison?: unknown } | undefined)?.comparison ?? "—", null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
            <Radar className="w-4 h-4 text-cyan-400" /> Agreement Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {agreement.error && isResearchLabUnavailable(agreement.error) ? <ResearchLabUnavailable label="agreement analysis" /> : (
            <pre className="text-xs font-mono text-cyan-100/70 whitespace-pre-wrap break-all">
              {JSON.stringify((agreement.data as { agreement?: unknown } | undefined)?.agreement ?? "—", null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
            <LineChart className="w-4 h-4 text-cyan-400" /> Regime Comparison
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {regimes.error && isResearchLabUnavailable(regimes.error) ? <ResearchLabUnavailable label="regime comparison" /> : (
            <pre className="text-xs font-mono text-cyan-100/70 whitespace-pre-wrap break-all">
              {JSON.stringify((regimes.data as { regimes?: unknown } | undefined)?.regimes ?? "—", null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminResearchLabShadowTesting() {
  const { data, error, isLoading } = useListResearchLabShadowDeployments(undefined, { query: { refetchInterval: 15_000 } as any });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const deployments = ((data as { deployments?: unknown[] } | undefined)?.deployments ?? []) as Array<Record<string, unknown>>;

  return (
    <OpsShell title="Research Lab — Shadow Testing" description="Active shadow deployments, challenger comparisons, regime comparisons, and agreement analysis.">
      {isLoading ? (
        <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING SHADOW DEPLOYMENTS... ]</div>
      ) : error && isResearchLabUnavailable(error) ? (
        <ResearchLabUnavailable />
      ) : selectedId ? (
        <div className="space-y-3">
          <button onClick={() => setSelectedId(null)} className="text-xs font-mono uppercase tracking-wider text-cyan-400 hover:text-cyan-300">← Back to list</button>
          <ShadowDetail id={selectedId} />
        </div>
      ) : deployments.length === 0 ? (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-12 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">[ No shadow deployments active ]</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {deployments.map((d) => (
            <Card key={d.id as string} className="border-cyan-900/40 bg-card/50 backdrop-blur cursor-pointer hover:border-cyan-700/60 transition-colors" onClick={() => setSelectedId(d.id as string)}>
              <CardContent className="py-4 px-5 flex items-center justify-between gap-3">
                <div className="font-mono font-bold text-sm text-cyan-50 truncate">{(d.name as string) ?? (d.id as string)}</div>
                <ChevronRight className="w-4 h-4 text-cyan-500/50 shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </OpsShell>
  );
}
