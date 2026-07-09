import { OpsShell } from "@/components/ops/ops-shell";
import { ResearchLabUnavailable, isResearchLabUnavailable } from "@/components/research-lab/unavailable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useListResearchLabValidationReports,
  useGetResearchLabDriftMonitoring,
  useListResearchLabRobustnessTests,
} from "@workspace/api-client-react";
import { ShieldCheck, TrendingDown, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function timeAgo(v: string | null | undefined) {
  if (!v) return "—";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

function ReportsTab() {
  const { data, error, isLoading } = useListResearchLabValidationReports(undefined, { query: { refetchInterval: 20_000 } as any });
  const reports = ((data as { reports?: unknown[] } | undefined)?.reports ?? []) as Array<Record<string, unknown>>;
  if (isLoading) return <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING... ]</div>;
  if (error && isResearchLabUnavailable(error)) return <ResearchLabUnavailable label="validation reports" />;
  if (reports.length === 0) return <Card className="border-cyan-900/40 bg-card/50 backdrop-blur"><CardContent className="py-12 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">[ No validation reports yet ]</CardContent></Card>;
  return (
    <div className="space-y-3">
      {reports.map((r) => (
        <Card key={r.id as string} className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-4 px-5">
            <div className="font-mono font-bold text-sm text-cyan-50">{(r.name as string) ?? (r.id as string)}</div>
            <div className="text-[10px] font-mono text-cyan-500/70 uppercase tracking-wider mt-0.5">{timeAgo(r.createdAt as string)}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DriftTab() {
  const { data, error, isLoading } = useGetResearchLabDriftMonitoring({ query: { refetchInterval: 20_000 } as any });
  if (isLoading) return <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING... ]</div>;
  if (error && isResearchLabUnavailable(error)) return <ResearchLabUnavailable label="drift monitoring" />;
  const drift = (data as { drift?: Record<string, unknown> } | undefined)?.drift;
  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
        <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
          <TrendingDown className="w-4 h-4 text-cyan-400" /> Drift Monitoring
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <pre className="text-xs font-mono text-cyan-100/70 whitespace-pre-wrap break-all">{drift ? JSON.stringify(drift, null, 2) : "—"}</pre>
      </CardContent>
    </Card>
  );
}

function RobustnessTab() {
  const { data, error, isLoading } = useListResearchLabRobustnessTests(undefined, { query: { refetchInterval: 20_000 } as any });
  const tests = ((data as { tests?: unknown[] } | undefined)?.tests ?? []) as Array<Record<string, unknown>>;
  if (isLoading) return <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING... ]</div>;
  if (error && isResearchLabUnavailable(error)) return <ResearchLabUnavailable label="robustness tests" />;
  if (tests.length === 0) return <Card className="border-cyan-900/40 bg-card/50 backdrop-blur"><CardContent className="py-12 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">[ No robustness tests yet ]</CardContent></Card>;
  return (
    <div className="space-y-3">
      {tests.map((t, i) => (
        <Card key={i} className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-4 px-5 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-mono text-cyan-100/70">{JSON.stringify(t)}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AdminResearchLabValidation() {
  return (
    <OpsShell title="Research Lab — Validation" description="Certification results, validation reports, drift monitoring, and robustness testing.">
      <Tabs defaultValue="reports">
        <TabsList>
          <TabsTrigger value="reports"><ShieldCheck className="w-3.5 h-3.5 mr-1.5" />Reports</TabsTrigger>
          <TabsTrigger value="drift"><TrendingDown className="w-3.5 h-3.5 mr-1.5" />Drift</TabsTrigger>
          <TabsTrigger value="robustness"><Zap className="w-3.5 h-3.5 mr-1.5" />Robustness</TabsTrigger>
        </TabsList>
        <TabsContent value="reports" className="mt-4"><ReportsTab /></TabsContent>
        <TabsContent value="drift" className="mt-4"><DriftTab /></TabsContent>
        <TabsContent value="robustness" className="mt-4"><RobustnessTab /></TabsContent>
      </Tabs>
    </OpsShell>
  );
}
