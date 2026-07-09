import { useState } from "react";
import { Link } from "wouter";
import { OpsShell } from "@/components/ops/ops-shell";
import { ResearchLabUnavailable, isResearchLabUnavailable } from "@/components/research-lab/unavailable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useGetTrainerControlStatus,
  usePostTrainerControlTrainingStart,
  usePostTrainerControlTrainingStop,
  usePostTrainerControlExperiments,
  usePostTrainerControlShadowTests,
  useListTrainerControlDatasets,
  useListTrainerControlMemory,
  useListTrainerControlReflections,
  useListTrainerControlResearchReports,
  useListTrainerControlActiveModels,
  useListTrainerControlRunpodJobs,
  useGetTrainerControlRunpodGpuUtilization,
  useGetTrainerControlTrainingCosts,
} from "@workspace/api-client-react";
import {
  Play, Square, FlaskConical, Radio, Database, Brain, BookOpen, FileText,
  Cpu, Server, Gauge, DollarSign, ExternalLink,
} from "lucide-react";

function PassthroughList({
  items, emptyLabel, idKey = "id", titleKey = "name",
}: {
  items: Array<Record<string, unknown>>;
  emptyLabel: string;
  idKey?: string;
  titleKey?: string;
}) {
  if (items.length === 0) {
    return (
      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardContent className="py-10 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">
          [ {emptyLabel} ]
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <Card key={(item[idKey] as string) ?? i} className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-3 px-4">
            <div className="font-mono text-xs font-bold text-cyan-50 mb-1">
              {(item[titleKey] as string) ?? (item[idKey] as string) ?? `#${i}`}
            </div>
            <pre className="text-[10px] font-mono text-cyan-100/60 whitespace-pre-wrap break-all">
              {JSON.stringify(item, null, 2)}
            </pre>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function InspectionSection<T extends Record<string, unknown>>({
  icon: Icon, title, useHook, dataKey, emptyLabel,
}: {
  icon: typeof Database;
  title: string;
  useHook: (opts?: any) => { data: unknown; error: unknown; isLoading: boolean };
  dataKey: string;
  emptyLabel: string;
}) {
  const { data, error, isLoading } = useHook({ query: { refetchInterval: 20_000 } as any });
  const items = ((data as Record<string, unknown> | undefined)?.[dataKey] ?? []) as Array<Record<string, unknown>>;
  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
        <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
          <Icon className="w-4 h-4 text-cyan-400" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading ? (
          <div className="text-cyan-500/50 text-xs py-6 text-center font-mono animate-pulse">[ LOADING... ]</div>
        ) : error && isResearchLabUnavailable(error) ? (
          <ResearchLabUnavailable label={title.toLowerCase()} />
        ) : (
          <PassthroughList items={items} emptyLabel={emptyLabel} />
        )}
      </CardContent>
    </Card>
  );
}

function ControlPanel() {
  const { toast } = useToast();
  const { data: status } = useGetTrainerControlStatus();
  const configured = (status as { configured?: boolean } | undefined)?.configured;

  const [runId, setRunId] = useState("");
  const [stopReason, setStopReason] = useState("");
  const [experimentJson, setExperimentJson] = useState('{\n  "name": ""\n}');
  const [trainingJson, setTrainingJson] = useState('{\n  "experimentId": ""\n}');
  const [shadowJson, setShadowJson] = useState('{\n  "candidateId": ""\n}');

  const startTraining = usePostTrainerControlTrainingStart({
    mutation: {
      onSuccess: () => toast({ title: "Training run started" }),
      onError: (err: any) => toast({ title: "Failed to start training", description: err?.message, variant: "destructive" }),
    },
  });
  const stopTraining = usePostTrainerControlTrainingStop({
    mutation: {
      onSuccess: () => { toast({ title: "Training run stopped" }); setRunId(""); setStopReason(""); },
      onError: (err: any) => toast({ title: "Failed to stop training", description: err?.message, variant: "destructive" }),
    },
  });
  const createExperiment = usePostTrainerControlExperiments({
    mutation: {
      onSuccess: () => toast({ title: "Experiment created" }),
      onError: (err: any) => toast({ title: "Failed to create experiment", description: err?.message, variant: "destructive" }),
    },
  });
  const launchShadowTest = usePostTrainerControlShadowTests({
    mutation: {
      onSuccess: () => toast({ title: "Shadow test launched" }),
      onError: (err: any) => toast({ title: "Failed to launch shadow test", description: err?.message, variant: "destructive" }),
    },
  });

  function parseJsonOrToast(raw: string): Record<string, unknown> | null {
    try {
      return JSON.parse(raw);
    } catch {
      toast({ title: "Invalid JSON", variant: "destructive" });
      return null;
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div
        className={`rounded-sm border px-4 py-3 text-xs font-mono flex items-center gap-2 ${
          configured ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-500" : "border-amber-500/30 bg-amber-500/5 text-amber-500"
        }`}
      >
        {configured
          ? "Trainer is configured. All control actions below are audit-logged, including failures."
          : "signalium-trainer's Research Lab API is not configured or not reachable — control actions will fail."}
      </div>

      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
            <Play className="w-4 h-4 text-cyan-400" /> Start Training Run
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <Label className="text-xs font-mono text-muted-foreground">Config (JSON)</Label>
          <Textarea value={trainingJson} onChange={(e) => setTrainingJson(e.target.value)} rows={4} className="font-mono text-xs" />
          <Button
            size="sm"
            disabled={startTraining.isPending || !configured}
            onClick={() => {
              const config = parseJsonOrToast(trainingJson);
              if (config) startTraining.mutate({ data: config });
            }}
            className="font-mono text-xs"
          >
            <Play className="w-3.5 h-3.5 mr-1.5" /> Start Training
          </Button>
        </CardContent>
      </Card>

      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
            <Square className="w-4 h-4 text-cyan-400" /> Stop Training Run
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground">Run ID</Label>
              <Input value={runId} onChange={(e) => setRunId(e.target.value)} className="font-mono text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground">Reason (optional)</Label>
              <Input value={stopReason} onChange={(e) => setStopReason(e.target.value)} className="font-mono text-sm" />
            </div>
          </div>
          <Button
            size="sm"
            variant="destructive"
            disabled={stopTraining.isPending || !runId || !configured}
            onClick={() => stopTraining.mutate({ id: runId, data: { reason: stopReason || undefined } })}
            className="font-mono text-xs"
          >
            <Square className="w-3.5 h-3.5 mr-1.5" /> Stop Training
          </Button>
        </CardContent>
      </Card>

      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
            <FlaskConical className="w-4 h-4 text-cyan-400" /> Create Experiment
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <Label className="text-xs font-mono text-muted-foreground">Config (JSON)</Label>
          <Textarea value={experimentJson} onChange={(e) => setExperimentJson(e.target.value)} rows={4} className="font-mono text-xs" />
          <Button
            size="sm"
            disabled={createExperiment.isPending || !configured}
            onClick={() => {
              const config = parseJsonOrToast(experimentJson);
              if (config) createExperiment.mutate({ data: config });
            }}
            className="font-mono text-xs"
          >
            <FlaskConical className="w-3.5 h-3.5 mr-1.5" /> Create Experiment
          </Button>
        </CardContent>
      </Card>

      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
            <Radio className="w-4 h-4 text-cyan-400" /> Launch Shadow Test
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <Label className="text-xs font-mono text-muted-foreground">Config (JSON)</Label>
          <Textarea value={shadowJson} onChange={(e) => setShadowJson(e.target.value)} rows={4} className="font-mono text-xs" />
          <Button
            size="sm"
            disabled={launchShadowTest.isPending || !configured}
            onClick={() => {
              const config = parseJsonOrToast(shadowJson);
              if (config) launchShadowTest.mutate({ data: config });
            }}
            className="font-mono text-xs"
          >
            <Radio className="w-3.5 h-3.5 mr-1.5" /> Launch Shadow Test
          </Button>
        </CardContent>
      </Card>

      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
            <ExternalLink className="w-4 h-4 text-cyan-400" /> Deploy / Rollback
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-2 text-xs font-mono text-cyan-100/70">
          <p>
            Deploy and rollback actions reuse the existing deployment manager surfaces rather than
            duplicating that logic here:
          </p>
          <div className="flex flex-col gap-2 pt-1">
            <Link href="/admin/deployments" className="text-cyan-400 hover:underline inline-flex items-center gap-1.5 w-fit">
              <ExternalLink className="w-3.5 h-3.5" /> Deployment Manager (activate / roll back)
            </Link>
            <Link href="/admin/research-lab/deployment" className="text-cyan-400 hover:underline inline-flex items-center gap-1.5 w-fit">
              <ExternalLink className="w-3.5 h-3.5" /> Research Lab Deployment Candidates
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TrainingCostsCard() {
  const { data, error, isLoading } = useGetTrainerControlTrainingCosts({ query: { refetchInterval: 20_000 } as any });
  const costs = data as { totalAccruedUsd?: number; activeHourlyUsd?: number; pods?: Array<Record<string, unknown>> } | undefined;
  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
        <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
          <DollarSign className="w-4 h-4 text-cyan-400" /> Training Costs
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading ? (
          <div className="text-cyan-500/50 text-xs py-6 text-center font-mono animate-pulse">[ LOADING... ]</div>
        ) : error ? (
          <div className="text-red-400 text-xs font-mono">Failed to load training costs.</div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-6">
              <div>
                <div className="text-[10px] font-mono text-cyan-500/60 uppercase tracking-wider">Total Accrued</div>
                <div className="text-lg font-mono font-bold text-cyan-50">${(costs?.totalAccruedUsd ?? 0).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[10px] font-mono text-cyan-500/60 uppercase tracking-wider">Active Hourly Rate</div>
                <div className="text-lg font-mono font-bold text-cyan-50">${(costs?.activeHourlyUsd ?? 0).toFixed(2)}/hr</div>
              </div>
            </div>
            <PassthroughList items={costs?.pods ?? []} emptyLabel="No pod cost data" titleKey="name" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GpuUtilizationCard() {
  const { data, error, isLoading } = useGetTrainerControlRunpodGpuUtilization({ query: { refetchInterval: 15_000 } as any });
  const utilization = ((data as { utilization?: Array<Record<string, unknown>> } | undefined)?.utilization ?? []);
  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
        <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
          <Gauge className="w-4 h-4 text-cyan-400" /> GPU Utilization
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading ? (
          <div className="text-cyan-500/50 text-xs py-6 text-center font-mono animate-pulse">[ LOADING... ]</div>
        ) : error ? (
          <div className="text-red-400 text-xs font-mono">Failed to load GPU utilization.</div>
        ) : utilization.length === 0 ? (
          <div className="text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider text-center py-6">[ No running pods ]</div>
        ) : (
          <div className="space-y-2">
            {utilization.map((u, i) => (
              <div key={(u.podId as number) ?? i} className="flex items-center justify-between text-xs font-mono text-cyan-100/70 border-b border-cyan-900/20 pb-2 last:border-0">
                <span>{(u.name as string) ?? `pod #${u.podId}`} — {u.gpuType as string}</span>
                <Badge className="bg-cyan-500/10 text-cyan-400 text-[10px]">
                  {u.utilizationPct != null ? `${u.utilizationPct}%` : "—"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RunpodJobsCard() {
  const { data, error, isLoading } = useListTrainerControlRunpodJobs({ query: { refetchInterval: 15_000 } as any });
  const jobs = ((data as { jobs?: Array<Record<string, unknown>> } | undefined)?.jobs ?? []);
  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
        <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
          <Server className="w-4 h-4 text-cyan-400" /> RunPod Jobs
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading ? (
          <div className="text-cyan-500/50 text-xs py-6 text-center font-mono animate-pulse">[ LOADING... ]</div>
        ) : error ? (
          <div className="text-red-400 text-xs font-mono">Failed to load RunPod jobs.</div>
        ) : (
          <PassthroughList items={jobs} emptyLabel="No RunPod pods recorded" />
        )}
      </CardContent>
    </Card>
  );
}

function InspectionPanel() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <InspectionSection icon={Database} title="Datasets" useHook={useListTrainerControlDatasets} dataKey="datasets" emptyLabel="No datasets" />
      <InspectionSection icon={Brain} title="Memory" useHook={useListTrainerControlMemory} dataKey="entries" emptyLabel="No memory entries" />
      <InspectionSection icon={BookOpen} title="Reflections" useHook={useListTrainerControlReflections} dataKey="reflections" emptyLabel="No reflections" />
      <InspectionSection icon={FileText} title="Research Reports" useHook={useListTrainerControlResearchReports} dataKey="reports" emptyLabel="No research reports" />
      <InspectionSection icon={Cpu} title="Active Models" useHook={useListTrainerControlActiveModels} dataKey="models" emptyLabel="No active models" />
      <RunpodJobsCard />
      <GpuUtilizationCard />
      <TrainingCostsCard />
    </div>
  );
}

export default function AdminTrainerControl() {
  return (
    <OpsShell
      title="Trainer Control Plane"
      description="Admin-only start/stop training, experiments, and shadow tests, plus read-only inspection of trainer state. All control actions are audit-logged."
    >
      <Tabs defaultValue="control" className="space-y-4">
        <TabsList>
          <TabsTrigger value="control" className="font-mono text-xs uppercase tracking-wider">Control</TabsTrigger>
          <TabsTrigger value="inspection" className="font-mono text-xs uppercase tracking-wider">Inspection</TabsTrigger>
        </TabsList>
        <TabsContent value="control">
          <ControlPanel />
        </TabsContent>
        <TabsContent value="inspection">
          <InspectionPanel />
        </TabsContent>
      </Tabs>
    </OpsShell>
  );
}
