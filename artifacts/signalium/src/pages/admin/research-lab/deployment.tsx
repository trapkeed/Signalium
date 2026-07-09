import { useState } from "react";
import { OpsShell } from "@/components/ops/ops-shell";
import { ResearchLabUnavailable, isResearchLabUnavailable } from "@/components/research-lab/unavailable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListResearchLabDeploymentCandidates,
  useGetResearchLabDeploymentCandidateHistory,
  useApproveResearchLabDeploymentCandidate,
  useRollbackResearchLabDeploymentCandidate,
  getListResearchLabDeploymentCandidatesQueryKey,
} from "@workspace/api-client-react";
import { CheckCircle2, RotateCcw, History, ShieldAlert } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function timeAgo(v: string | null | undefined) {
  if (!v) return "—";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

function HistoryCard() {
  const { data, error, isLoading } = useGetResearchLabDeploymentCandidateHistory(undefined, { query: { refetchInterval: 30_000 } as any });
  if (isLoading) return null;
  if (error && isResearchLabUnavailable(error)) return null;
  const history = ((data as { history?: unknown[] } | undefined)?.history ?? []) as Array<Record<string, unknown>>;
  if (history.length === 0) return null;
  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
        <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
          <History className="w-4 h-4 text-cyan-400" /> Deployment History
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-2">
        {history.map((h, i) => (
          <div key={i} className="text-xs font-mono text-cyan-100/70">{JSON.stringify(h)}</div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function AdminResearchLabDeployment() {
  const { data, error, isLoading } = useListResearchLabDeploymentCandidates(undefined, { query: { refetchInterval: 10_000 } as any });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);
  const [rollbackReason, setRollbackReason] = useState("");

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: getListResearchLabDeploymentCandidatesQueryKey() });

  const approveMutation = useApproveResearchLabDeploymentCandidate({
    mutation: {
      onSuccess: (d) => { toast({ title: (d as { message?: string })?.message ?? "Approved" }); invalidate(); },
      onError: () => toast({ title: "Approval failed", variant: "destructive" }),
    },
  });
  const rollbackMutation = useRollbackResearchLabDeploymentCandidate({
    mutation: {
      onSuccess: (d) => { toast({ title: (d as { message?: string })?.message ?? "Rolled back" }); invalidate(); setRollbackTarget(null); setRollbackReason(""); },
      onError: () => toast({ title: "Rollback failed", variant: "destructive" }),
    },
  });

  const candidates = ((data as { candidates?: unknown[] } | undefined)?.candidates ?? []) as Array<Record<string, unknown>>;

  return (
    <OpsShell title="Research Lab — Deployment" description="Deployment candidates: approve, roll back, and review history. All actions are audit-logged.">
      {isLoading ? (
        <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING CANDIDATES... ]</div>
      ) : error && isResearchLabUnavailable(error) ? (
        <ResearchLabUnavailable />
      ) : (
        <div className="space-y-4 sm:space-y-6">
          {candidates.length === 0 ? (
            <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
              <CardContent className="py-12 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">[ No deployment candidates pending ]</CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {candidates.map((c) => (
                <Card key={c.id as string} className="border-cyan-900/40 bg-card/50 backdrop-blur">
                  <CardContent className="py-4 px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-sm text-cyan-50 flex items-center gap-2">
                        <ShieldAlert className="w-3.5 h-3.5 text-cyan-400" />
                        {(c.version as string) ?? (c.id as string)}
                      </div>
                      <div className="text-[10px] font-mono text-cyan-500/70 uppercase tracking-wider mt-0.5">{timeAgo(c.createdAt as string)}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.status ? <Badge className="text-[10px] font-mono uppercase">{c.status as string}</Badge> : null}
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-emerald-900/50 text-emerald-400 hover:bg-emerald-900/20"
                        disabled={approveMutation.isPending}
                        onClick={() => approveMutation.mutate({ id: c.id as string })}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-900/50 text-red-400 hover:bg-red-900/20"
                        onClick={() => setRollbackTarget(c.id as string)}
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Rollback
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <HistoryCard />
        </div>
      )}

      <Dialog open={!!rollbackTarget} onOpenChange={(open) => !open && setRollbackTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roll back deployment candidate?</DialogTitle>
            <DialogDescription>
              This calls signalium-trainer to roll back {rollbackTarget}. This action is audit-logged and cannot be undone from here.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason (optional)"
            value={rollbackReason}
            onChange={(e) => setRollbackReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rollbackMutation.isPending}
              onClick={() => rollbackTarget && rollbackMutation.mutate({ id: rollbackTarget, data: { reason: rollbackReason || undefined } })}
            >
              Confirm Rollback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OpsShell>
  );
}
