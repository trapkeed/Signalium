import { OpsShell } from "@/components/ops/ops-shell";
import { ResearchLabUnavailable, isResearchLabUnavailable } from "@/components/research-lab/unavailable";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useListResearchLabDiscoveredFeatures,
  useListResearchLabFailureInvestigations,
  useListResearchLabSelfEvaluationFindings,
  useListResearchLabRetrainingRecommendations,
} from "@workspace/api-client-react";
import { Sparkles, Search, Microscope, RefreshCcw } from "lucide-react";

function ListTab({
  items, error, isLoading, emptyLabel, unavailableLabel,
}: {
  items: Array<Record<string, unknown>>;
  error: unknown;
  isLoading: boolean;
  emptyLabel: string;
  unavailableLabel: string;
}) {
  if (isLoading) return <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING... ]</div>;
  if (error && isResearchLabUnavailable(error)) return <ResearchLabUnavailable label={unavailableLabel} />;
  if (items.length === 0) {
    return <Card className="border-cyan-900/40 bg-card/50 backdrop-blur"><CardContent className="py-12 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">[ {emptyLabel} ]</CardContent></Card>;
  }
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <Card key={i} className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-4 px-5">
            <pre className="text-xs font-mono text-cyan-100/70 whitespace-pre-wrap break-all">{JSON.stringify(item, null, 2)}</pre>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AdminResearchLabResearchIntelligence() {
  const features = useListResearchLabDiscoveredFeatures(undefined, { query: { refetchInterval: 30_000 } as any });
  const investigations = useListResearchLabFailureInvestigations(undefined, { query: { refetchInterval: 30_000 } as any });
  const evaluations = useListResearchLabSelfEvaluationFindings(undefined, { query: { refetchInterval: 30_000 } as any });
  const recommendations = useListResearchLabRetrainingRecommendations(undefined, { query: { refetchInterval: 30_000 } as any });

  return (
    <OpsShell title="Research Lab — Research Intelligence" description="Discovered features, failure investigations, self-evaluation findings, and retraining recommendations.">
      <Tabs defaultValue="features">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="features"><Sparkles className="w-3.5 h-3.5 mr-1.5" />Features</TabsTrigger>
          <TabsTrigger value="investigations"><Search className="w-3.5 h-3.5 mr-1.5" />Failure Investigations</TabsTrigger>
          <TabsTrigger value="evaluations"><Microscope className="w-3.5 h-3.5 mr-1.5" />Self-Evaluations</TabsTrigger>
          <TabsTrigger value="recommendations"><RefreshCcw className="w-3.5 h-3.5 mr-1.5" />Retraining Recs</TabsTrigger>
        </TabsList>
        <TabsContent value="features" className="mt-4">
          <ListTab
            items={((features.data as { features?: unknown[] } | undefined)?.features ?? []) as Array<Record<string, unknown>>}
            error={features.error}
            isLoading={features.isLoading}
            emptyLabel="No discovered features yet"
            unavailableLabel="discovered features"
          />
        </TabsContent>
        <TabsContent value="investigations" className="mt-4">
          <ListTab
            items={((investigations.data as { investigations?: unknown[] } | undefined)?.investigations ?? []) as Array<Record<string, unknown>>}
            error={investigations.error}
            isLoading={investigations.isLoading}
            emptyLabel="No failure investigations yet"
            unavailableLabel="failure investigations"
          />
        </TabsContent>
        <TabsContent value="evaluations" className="mt-4">
          <ListTab
            items={((evaluations.data as { findings?: unknown[] } | undefined)?.findings ?? []) as Array<Record<string, unknown>>}
            error={evaluations.error}
            isLoading={evaluations.isLoading}
            emptyLabel="No self-evaluation findings yet"
            unavailableLabel="self-evaluation findings"
          />
        </TabsContent>
        <TabsContent value="recommendations" className="mt-4">
          <ListTab
            items={((recommendations.data as { recommendations?: unknown[] } | undefined)?.recommendations ?? []) as Array<Record<string, unknown>>}
            error={recommendations.error}
            isLoading={recommendations.isLoading}
            emptyLabel="No retraining recommendations yet"
            unavailableLabel="retraining recommendations"
          />
        </TabsContent>
      </Tabs>
    </OpsShell>
  );
}
