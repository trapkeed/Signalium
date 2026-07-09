/**
 * S19 — Trade Intelligence Admin Page
 *
 * Provides a comprehensive view of all QDE decision telemetry, trade outcomes,
 * position intelligence, and learning-loop data collected by the S19 pipeline.
 */

import { useState } from "react";
import {
  useGetQdeAdminTradeIntelligenceStats,
  useGetQdeAdminDecisions,
  useGetQdeAdminTradeTimeline,
  useGetQdeAdminLearningQueue,
  usePostQdeAdminLearningQueueIdMarkProcessed,
  useGetQdeAdminTradeFailures,
  useGetQdeAdminFailurePatterns,
  useGetQdeSelfEvaluation,
  usePostQdeSelfEvaluationGenerate,
  useGetQdeTrainerSyncStatus,
  usePostQdeTrainerSync,
  useGetQdeAnalyticsSessions,
  useGetQdeAnalyticsSymbols,
  useGetQdeAnalyticsConfidenceReliability,
  useGetQdeAnalyticsModelQuality,
  type TradeIntelligenceStats,
  type TradeTimeline,
  type SelfEvaluationReport,
  type TrainerSyncState,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Brain,
  TrendingUp,
  Activity,
  BookOpen,
  AlertTriangle,
  Zap,
  RefreshCw,
  Clock,
  BarChart3,
  Target,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}
function fmtR(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}
function fmtPnl(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}$${n.toFixed(2)}`;
}
function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return "—";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${Math.round(secs / 3600)}h`;
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function outcomeBadge(outcome: string) {
  if (outcome === "win") return <Badge className="bg-green-500/20 text-green-400">Win</Badge>;
  if (outcome === "loss") return <Badge className="bg-red-500/20 text-red-400">Loss</Badge>;
  return <Badge className="bg-zinc-500/20 text-zinc-400">BE</Badge>;
}

function directionBadge(dir: string | null | undefined) {
  if (!dir) return <Badge variant="outline">—</Badge>;
  if (dir === "LONG") return <Badge className="bg-green-500/20 text-green-400">{dir}</Badge>;
  if (dir === "SHORT") return <Badge className="bg-red-500/20 text-red-400">{dir}</Badge>;
  return <Badge variant="outline">{dir}</Badge>;
}

function candidateTypeBadge(type: string) {
  const map: Record<string, string> = {
    large_loss: "bg-red-500/20 text-red-400",
    large_win: "bg-green-500/20 text-green-400",
    high_confidence_failure: "bg-orange-500/20 text-orange-400",
    unexpected_reversal: "bg-yellow-500/20 text-yellow-400",
    perfect_execution: "bg-blue-500/20 text-blue-400",
  };
  return <Badge className={map[type] ?? "bg-zinc-700 text-zinc-300"}>{type.replace(/_/g, " ")}</Badge>;
}

const CHART_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ stats }: { stats: TradeIntelligenceStats | undefined }) {
  if (!stats) return <div className="text-zinc-500 py-8 text-center">Loading stats…</div>;

  const kpis = [
    { icon: Brain, label: "QDE Decisions", value: (stats.decisions ?? 0).toLocaleString(), color: "text-purple-400" },
    { icon: Activity, label: "Trade Timelines", value: (stats.timelines ?? 0).toLocaleString(), color: "text-blue-400" },
    { icon: AlertTriangle, label: "Trade Failures", value: (stats.failures ?? 0).toLocaleString(), color: "text-red-400" },
    { icon: BookOpen, label: "Learning Queue", value: (stats.learningQueueDepth ?? 0).toLocaleString(), color: "text-yellow-400" },
    { icon: Clock, label: "Validation Pending", value: (stats.validationPending ?? 0).toLocaleString(), color: "text-orange-400" },
    {
      icon: Target, label: "Win Rate", value: pct(stats.overall?.winRate),
      color: (stats.overall?.winRate ?? 0) >= 0.5 ? "text-green-400" : "text-red-400",
    },
    {
      icon: TrendingUp, label: "Avg R-Multiple", value: fmtR(stats.overall?.avgRMultiple),
      color: (stats.overall?.avgRMultiple ?? 0) >= 0 ? "text-green-400" : "text-red-400",
    },
    {
      icon: BarChart3, label: "Total P/L", value: fmtPnl(stats.overall?.totalPnl),
      color: (stats.overall?.totalPnl ?? 0) >= 0 ? "text-green-400" : "text-red-400",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <Card key={k.label} className="bg-zinc-900 border-zinc-800">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <k.icon className={`w-4 h-4 ${k.color}`} />
                <span className="text-xs text-zinc-500">{k.label}</span>
              </div>
              <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader><CardTitle className="text-sm">Trainer Sync Status</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${
              stats.trainerSyncStatus === "ok" ? "bg-green-400"
              : stats.trainerSyncStatus === "error" ? "bg-red-400"
              : "bg-zinc-500"
            }`} />
            <span className="text-sm text-zinc-300">{stats.trainerSyncStatus ?? "Never synced"}</span>
            {stats.lastTrainerSync && (
              <span className="text-xs text-zinc-500">Last: {fmtDate(stats.lastTrainerSync)}</span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Decisions Tab ────────────────────────────────────────────────────────────

function DecisionsTab() {
  const { data, isLoading } = useGetQdeAdminDecisions({ limit: 100 });
  if (isLoading) return <div className="text-zinc-500 py-8 text-center">Loading decisions…</div>;

  const rows = (data as { rows?: unknown[] } | undefined)?.rows ?? [];
  const total = (data as { total?: number } | undefined)?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="text-sm text-zinc-500">{total} total decisions</div>
      <div className="rounded-md border border-zinc-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead>Time</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Session</TableHead>
              <TableHead>Trainer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-zinc-500 py-8">No decisions yet</TableCell>
              </TableRow>
            ) : (rows as Array<Record<string, unknown>>).map((d) => (
              <TableRow key={String(d.id)} className="border-zinc-800 hover:bg-zinc-800/50">
                <TableCell className="text-xs text-zinc-400">{fmtDate(d.createdAt as string)}</TableCell>
                <TableCell className="font-mono text-sm">{String(d.symbol)}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{String(d.inferenceType)}</Badge></TableCell>
                <TableCell>{directionBadge(d.direction as string | null)}</TableCell>
                <TableCell>{d.confidence != null ? `${((d.confidence as number) * 100).toFixed(0)}%` : "—"}</TableCell>
                <TableCell className="text-xs text-zinc-400">{String(d.session ?? "—")}</TableCell>
                <TableCell>
                  {d.trainerOnline
                    ? <Badge className="bg-green-500/20 text-green-400 text-xs">Online</Badge>
                    : <Badge className="bg-zinc-500/20 text-zinc-400 text-xs">Offline</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Timelines Tab ────────────────────────────────────────────────────────────

function TimelinesTab() {
  const { data, isLoading } = useGetQdeAdminTradeTimeline({ limit: 100 });
  if (isLoading) return <div className="text-zinc-500 py-8 text-center">Loading timelines…</div>;

  const rows = ((data as { rows?: TradeTimeline[] } | undefined)?.rows ?? []) as TradeTimeline[];
  const total = (data as { total?: number } | undefined)?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="text-sm text-zinc-500">{total} completed trades</div>
      <div className="rounded-md border border-zinc-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead>Exit Time</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>P/L</TableHead>
              <TableHead>R-Multiple</TableHead>
              <TableHead>Session</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Events</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-zinc-500 py-8">No completed trades yet</TableCell>
              </TableRow>
            ) : rows.map((t) => (
              <TableRow key={t.id} className="border-zinc-800 hover:bg-zinc-800/50">
                <TableCell className="text-xs text-zinc-400">{fmtDate((t as unknown as Record<string, unknown>).exitAt as string)}</TableCell>
                <TableCell className="font-mono text-sm">{t.symbol}</TableCell>
                <TableCell>{outcomeBadge(t.outcome)}</TableCell>
                <TableCell className={(t.finalPnl ?? 0) >= 0 ? "text-green-400" : "text-red-400"}>{fmtPnl(t.finalPnl)}</TableCell>
                <TableCell className={(t.rMultiple ?? 0) >= 0 ? "text-green-400" : "text-red-400"}>{fmtR(t.rMultiple)}</TableCell>
                <TableCell className="text-xs text-zinc-400">{(t.session as string | null) ?? "—"}</TableCell>
                <TableCell className="text-xs text-zinc-400">{fmtDuration(t.durationSeconds)}</TableCell>
                <TableCell className="text-xs text-zinc-400">{t.totalEvents}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Analytics Tab ────────────────────────────────────────────────────────────

function AnalyticsTab() {
  type SessionRow = { session: string; totalTrades: number; winRate: number; avgRMultiple: number; totalPnl: number };
  type SymbolRow = { symbol: string; totalTrades: number; winRate: number; avgRMultiple: number; totalPnl: number };
  type ConfRow = { bucket: string; total: number; winRate: number };
  type ModelRow = { week: string; winRate: number; avgRMultiple: number; totalTrades: number };

  const { data: sessionData } = useGetQdeAnalyticsSessions();
  const { data: symbolData } = useGetQdeAnalyticsSymbols();
  const { data: confidenceData } = useGetQdeAnalyticsConfidenceReliability();
  const { data: modelData } = useGetQdeAnalyticsModelQuality();

  const sessions = (sessionData as SessionRow[] | undefined) ?? [];
  const symbols = ((symbolData as SymbolRow[] | undefined) ?? []).slice(0, 10);
  const confidence = (confidenceData as ConfRow[] | undefined) ?? [];
  const modelQuality = (modelData as ModelRow[] | undefined) ?? [];

  if (sessions.length === 0 && symbols.length === 0 && confidence.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <BarChart3 className="mx-auto mb-2 w-8 h-8 opacity-50" />
        <p>Analytics will appear once trades are completed and finalised.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sessions.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-sm">Session Win Rate</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sessions}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="session" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a" }} formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                <Bar dataKey="winRate" name="Win Rate">
                  {sessions.map((_: SessionRow, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {confidence.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-sm">Confidence Reliability</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={confidence}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="bucket" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <YAxis domain={[0, 1]} tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a" }} formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                <Bar dataKey="winRate" name="Win Rate" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {modelQuality.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-sm">Weekly Win Rate Trend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={modelQuality}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="week" tick={{ fill: "#a1a1aa", fontSize: 10 }} />
                <YAxis domain={[0, 1]} tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a" }} formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                <Line type="monotone" dataKey="winRate" stroke="#22c55e" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {symbols.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-sm">Top Symbols by P/L</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead>Symbol</TableHead>
                  <TableHead>Trades</TableHead>
                  <TableHead>Win Rate</TableHead>
                  <TableHead>Avg R</TableHead>
                  <TableHead>Total P/L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {symbols.map((s: SymbolRow) => (
                  <TableRow key={s.symbol} className="border-zinc-800 hover:bg-zinc-800/50">
                    <TableCell className="font-mono">{s.symbol}</TableCell>
                    <TableCell>{s.totalTrades}</TableCell>
                    <TableCell className={s.winRate >= 0.5 ? "text-green-400" : "text-red-400"}>{pct(s.winRate)}</TableCell>
                    <TableCell className={s.avgRMultiple >= 0 ? "text-green-400" : "text-red-400"}>{fmtR(s.avgRMultiple)}</TableCell>
                    <TableCell className={s.totalPnl >= 0 ? "text-green-400" : "text-red-400"}>{fmtPnl(s.totalPnl)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Learning Queue Tab ───────────────────────────────────────────────────────

function LearningQueueTab() {
  const { data, isLoading, refetch } = useGetQdeAdminLearningQueue({ limit: 200 });
  const markProcessed = usePostQdeAdminLearningQueueIdMarkProcessed();
  const { toast } = useToast();

  type Candidate = {
    id: number;
    opportunityId: number;
    symbol: string;
    candidateType: string;
    priority: number;
    processedByTrainer: boolean;
    processedAt: string | null;
    createdAt: string;
  };

  const rows: Candidate[] = ((data as { rows?: Candidate[] } | undefined)?.rows ?? []);
  const unprocessed: number = (data as { unprocessed?: number } | undefined)?.unprocessed ?? 0;

  const handleMark = async (id: number) => {
    try {
      await markProcessed.mutateAsync({ id });
      toast({ title: "Marked as processed" });
      void refetch();
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    }
  };

  if (isLoading) return <div className="text-zinc-500 py-8 text-center">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="text-sm text-zinc-500">{unprocessed} unprocessed candidates</div>
      <div className="rounded-md border border-zinc-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead>Created</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Opp</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-zinc-500 py-8">Queue is empty</TableCell></TableRow>
            ) : rows.map((c: Candidate) => (
              <TableRow key={c.id} className="border-zinc-800 hover:bg-zinc-800/50">
                <TableCell className="text-xs text-zinc-400">{fmtDate(c.createdAt)}</TableCell>
                <TableCell className="font-mono text-sm">{c.symbol}</TableCell>
                <TableCell>{candidateTypeBadge(c.candidateType)}</TableCell>
                <TableCell>
                  <Badge className={c.priority >= 8 ? "bg-red-500/20 text-red-400" : c.priority >= 5 ? "bg-yellow-500/20 text-yellow-400" : "bg-zinc-700 text-zinc-300"}>
                    P{c.priority}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-zinc-400">#{c.opportunityId}</TableCell>
                <TableCell>
                  {c.processedByTrainer
                    ? <Badge className="bg-green-500/20 text-green-400 text-xs">Processed</Badge>
                    : <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">Pending</Badge>}
                </TableCell>
                <TableCell>
                  {!c.processedByTrainer && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={markProcessed.isPending}
                      onClick={() => handleMark(c.id)}
                    >
                      Mark Processed
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Failures Tab ─────────────────────────────────────────────────────────────

function FailuresTab() {
  const { data: failureData, isLoading } = useGetQdeAdminTradeFailures({ limit: 100 });
  const { data: patternData } = useGetQdeAdminFailurePatterns();

  type FailureRow = {
    id: number;
    opportunityId: number;
    symbol: string;
    rootCause: string | null;
    finalLoss: number;
    maxAdverseExcursion: number | null;
    adminNotes: string | null;
    investigatedAt: string | null;
    createdAt: string;
  };
  type PatternRow = {
    id: number;
    patternType: string;
    symbol: string;
    session: string;
    occurrences: number;
    avgLoss: number | null;
  };

  const failures = (failureData as FailureRow[] | undefined) ?? [];
  const patterns = (patternData as PatternRow[] | undefined) ?? [];

  if (isLoading) return <div className="text-zinc-500 py-8 text-center">Loading…</div>;

  return (
    <div className="space-y-6">
      {patterns.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-sm">Recurring Failure Patterns</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead>Pattern</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Session</TableHead>
                  <TableHead>Occurrences</TableHead>
                  <TableHead>Avg Loss</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patterns.map((p: PatternRow) => (
                  <TableRow key={p.id} className="border-zinc-800 hover:bg-zinc-800/50">
                    <TableCell className="text-sm font-medium">{p.patternType}</TableCell>
                    <TableCell className="font-mono text-sm">{p.symbol}</TableCell>
                    <TableCell className="text-xs text-zinc-400">{p.session}</TableCell>
                    <TableCell>
                      <Badge className={p.occurrences >= 5 ? "bg-red-500/20 text-red-400" : "bg-orange-500/20 text-orange-400"}>
                        {p.occurrences}×
                      </Badge>
                    </TableCell>
                    <TableCell className="text-red-400">{fmtPnl(p.avgLoss)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader><CardTitle className="text-sm">Trade Failure Investigations</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead>Date</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Final Loss</TableHead>
                <TableHead>MAE</TableHead>
                <TableHead>Root Cause</TableHead>
                <TableHead>Investigated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failures.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-zinc-500 py-8">No failures recorded</TableCell></TableRow>
              ) : failures.map((f: FailureRow) => (
                <TableRow key={f.id} className="border-zinc-800 hover:bg-zinc-800/50">
                  <TableCell className="text-xs text-zinc-400">{fmtDate(f.createdAt)}</TableCell>
                  <TableCell className="font-mono text-sm">{f.symbol}</TableCell>
                  <TableCell className="text-red-400">{fmtPnl(f.finalLoss)}</TableCell>
                  <TableCell className="text-red-400">{fmtPnl(f.maxAdverseExcursion)}</TableCell>
                  <TableCell className="text-xs text-zinc-400 max-w-[200px] truncate">{f.rootCause ?? "—"}</TableCell>
                  <TableCell>
                    {f.investigatedAt
                      ? <Badge className="bg-green-500/20 text-green-400 text-xs">Yes</Badge>
                      : <Badge className="bg-zinc-500/20 text-zinc-400 text-xs">No</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Self-Evaluation Tab ──────────────────────────────────────────────────────

function SelfEvalTab() {
  const { data: reports, isLoading, refetch } = useGetQdeSelfEvaluation({ limit: 20 });
  const generate = usePostQdeSelfEvaluationGenerate();
  const { toast } = useToast();
  const [reportType, setReportType] = useState<"daily" | "weekly" | "monthly">("weekly");

  const handleGenerate = async () => {
    try {
      await generate.mutateAsync({ data: { reportType } });
      toast({ title: "Report generated" });
      void refetch();
    } catch {
      toast({ title: "Failed to generate report", variant: "destructive" });
    }
  };

  const rows = (reports as SelfEvaluationReport[] | undefined) ?? [];

  if (isLoading) return <div className="text-zinc-500 py-8 text-center">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={reportType} onValueChange={(v) => setReportType(v as "daily" | "weekly" | "monthly")}>
          <SelectTrigger className="w-36 bg-zinc-900 border-zinc-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={handleGenerate} disabled={generate.isPending}>
          <Zap className="w-4 h-4 mr-2" />
          {generate.isPending ? "Generating…" : "Generate Report"}
        </Button>
      </div>

      <div className="space-y-4">
        {rows.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            <BookOpen className="mx-auto mb-2 w-8 h-8 opacity-50" />
            <p>No reports yet. Click "Generate Report" to produce one.</p>
          </div>
        ) : rows.map((r: SelfEvaluationReport) => (
          <Card key={r.id} className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm capitalize">{r.reportType} Report</CardTitle>
                <span className="text-xs text-zinc-500">{fmtDate(r.createdAt)}</span>
              </div>
              <div className="text-xs text-zinc-500">
                {fmtDate(r.periodStart)} → {fmtDate(r.periodEnd)}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><div className="text-xs text-zinc-500">Trades</div><div className="text-lg font-bold">{r.totalTrades}</div></div>
                <div>
                  <div className="text-xs text-zinc-500">Win Rate</div>
                  <div className={`text-lg font-bold ${(r.winRate ?? 0) >= 0.5 ? "text-green-400" : "text-red-400"}`}>{pct(r.winRate)}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Avg R</div>
                  <div className={`text-lg font-bold ${(r.avgRMultiple ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtR(r.avgRMultiple)}</div>
                </div>
                <div><div className="text-xs text-zinc-500">Sharpe</div><div className="text-lg font-bold">{r.sharpeRatio?.toFixed(2) ?? "—"}</div></div>
              </div>
              {(r.insights ?? []).length > 0 && (
                <div className="space-y-1">
                  {(r.insights ?? []).map((insight: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-zinc-400">
                      <span className="text-zinc-600 mt-0.5">•</span>
                      <span>{insight}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Trainer Sync Tab ─────────────────────────────────────────────────────────

function TrainerSyncTab() {
  const { data: syncState, isLoading, refetch } = useGetQdeTrainerSyncStatus();
  const triggerSync = usePostQdeTrainerSync();
  const { toast } = useToast();

  const state = syncState as TrainerSyncState | undefined;

  const handleSync = async () => {
    try {
      await triggerSync.mutateAsync();
      toast({ title: "Sync completed" });
      void refetch();
    } catch {
      toast({ title: "Sync failed", variant: "destructive" });
    }
  };

  if (isLoading) return <div className="text-zinc-500 py-8 text-center">Loading…</div>;

  return (
    <div className="space-y-4">
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader><CardTitle className="text-sm">Trainer Sync Status</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><div className="text-xs text-zinc-500">Total Syncs</div><div className="text-xl font-bold">{state?.totalSyncs ?? 0}</div></div>
            <div><div className="text-xs text-zinc-500">Last Sync</div><div className="text-sm">{fmtDate(state?.lastSyncAt)}</div></div>
            <div>
              <div className="text-xs text-zinc-500">Status</div>
              {state?.lastSyncStatus === "ok"
                ? <Badge className="bg-green-500/20 text-green-400">OK</Badge>
                : state?.lastSyncStatus === "error"
                ? <Badge className="bg-red-500/20 text-red-400">Error</Badge>
                : <Badge className="bg-zinc-500/20 text-zinc-400">Never</Badge>}
            </div>
            <div>
              <div className="text-xs text-zinc-500">Last Message</div>
              <div className="text-xs text-zinc-400 truncate">{(state as Record<string, unknown> | undefined)?.lastSyncMessage as string ?? "—"}</div>
            </div>
          </div>
          {state && (state.totalSyncs ?? 0) > 0 && (
            <div className="grid grid-cols-3 gap-4 pt-2 border-t border-zinc-800">
              <div><div className="text-xs text-zinc-500">Decisions</div><div className="font-bold">{state.decisionsExported ?? 0}</div></div>
              <div><div className="text-xs text-zinc-500">Timelines</div><div className="font-bold">{state.timelinesExported ?? 0}</div></div>
              <div><div className="text-xs text-zinc-500">Candidates</div><div className="font-bold">{state.candidatesExported ?? 0}</div></div>
            </div>
          )}
        </CardContent>
      </Card>
      <Button onClick={handleSync} disabled={triggerSync.isPending}>
        <RefreshCw className={`w-4 h-4 mr-2 ${triggerSync.isPending ? "animate-spin" : ""}`} />
        {triggerSync.isPending ? "Syncing…" : "Trigger Trainer Sync"}
      </Button>
      <p className="text-xs text-zinc-500">
        Sends all decisions, timelines, execution telemetry, and unprocessed learning candidates since the last sync to
        the trainer. When QDE_TRAINER_URL is not configured the batch is prepared locally.
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TradeIntelligencePage() {
  const { data: stats } = useGetQdeAdminTradeIntelligenceStats();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="w-6 h-6 text-purple-400" />
          Trade Intelligence
        </h1>
        <p className="text-zinc-500 mt-1 text-sm">
          S19 — Institutional telemetry, position intelligence, and continuous learning loop
        </p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="bg-zinc-900 border border-zinc-800">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="decisions">Decisions</TabsTrigger>
          <TabsTrigger value="timelines">Timelines</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="learning">Learning Queue</TabsTrigger>
          <TabsTrigger value="failures">Failures</TabsTrigger>
          <TabsTrigger value="selfeval">Self-Eval</TabsTrigger>
          <TabsTrigger value="sync">Trainer Sync</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab stats={stats as TradeIntelligenceStats | undefined} />
        </TabsContent>
        <TabsContent value="decisions" className="mt-4"><DecisionsTab /></TabsContent>
        <TabsContent value="timelines" className="mt-4"><TimelinesTab /></TabsContent>
        <TabsContent value="analytics" className="mt-4"><AnalyticsTab /></TabsContent>
        <TabsContent value="learning" className="mt-4"><LearningQueueTab /></TabsContent>
        <TabsContent value="failures" className="mt-4"><FailuresTab /></TabsContent>
        <TabsContent value="selfeval" className="mt-4"><SelfEvalTab /></TabsContent>
        <TabsContent value="sync" className="mt-4"><TrainerSyncTab /></TabsContent>
      </Tabs>
    </div>
  );
}
