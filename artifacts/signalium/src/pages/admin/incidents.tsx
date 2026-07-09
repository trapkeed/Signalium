import { useState } from "react";
import {
  useGetOperationalIncidents,
  usePostOperationalIncidents,
  usePatchOperationalIncidentsId,
  useDeleteOperationalIncidentsId,
} from "@workspace/api-client-react";
import { getGetOperationalIncidentsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, Plus, CheckCircle2, Edit, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { OpsShell } from "@/components/ops/ops-shell";
import { useOpsRealtimeTypes } from "@/hooks/use-ops-realtime";

function timeAgo(v: string | null | undefined) {
  if (!v) return "—";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

type IncidentStatus = "INCIDENT_OPEN" | "INVESTIGATING" | "RESOLVED";
type IncidentCategory = "BROKER" | "EA" | "SERVER" | "PAYMENT" | "MODEL" | "NETWORK";
type IncidentSeverity = "low" | "medium" | "high" | "critical";

const STATUS_COLORS: Record<IncidentStatus, string> = {
  INCIDENT_OPEN: "bg-red-950/30 text-red-400 border-red-900/50",
  INVESTIGATING: "bg-yellow-950/30 text-yellow-400 border-yellow-900/50",
  RESOLVED:      "bg-emerald-950/30 text-emerald-400 border-emerald-900/50",
};

const SEV_COLORS: Record<IncidentSeverity, string> = {
  low:      "bg-cyan-950/50 text-cyan-400",
  medium:   "bg-yellow-950/50 text-yellow-400",
  high:     "bg-orange-950/50 text-orange-400",
  critical: "bg-red-950/50 text-red-400",
};

const CATEGORIES: IncidentCategory[] = ["BROKER", "EA", "SERVER", "PAYMENT", "MODEL", "NETWORK"];
const SEVERITIES: IncidentSeverity[] = ["low", "medium", "high", "critical"];
const STATUSES: IncidentStatus[] = ["INCIDENT_OPEN", "INVESTIGATING", "RESOLVED"];

type IncidentRow = {
  id: number;
  title: string;
  description: string | null;
  category: IncidentCategory;
  status: IncidentStatus;
  severity: IncidentSeverity;
  affectedUsersCount: number | null;
  actorUserId: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

// ─── Form state ───────────────────────────────────────────────────────────────

type FormState = {
  title: string;
  description: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  affectedUsersCount: string;
};

const defaultForm: FormState = {
  title: "",
  description: "",
  category: "SERVER",
  severity: "medium",
  status: "INCIDENT_OPEN",
  affectedUsersCount: "0",
};

// ─── Create/Edit Dialog ───────────────────────────────────────────────────────

function IncidentDialog({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing?: IncidentRow;
}) {
  const [form, setForm] = useState<FormState>(
    existing
      ? {
          title: existing.title,
          description: existing.description ?? "",
          category: existing.category,
          severity: existing.severity,
          status: existing.status,
          affectedUsersCount: String(existing.affectedUsersCount ?? 0),
        }
      : defaultForm,
  );

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createMutation = usePostOperationalIncidents({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetOperationalIncidentsQueryKey() });
        toast({ title: "Incident created" });
        onClose();
      },
      onError: () => toast({ title: "Failed to create incident", variant: "destructive" }),
    },
  });
  const updateMutation = usePatchOperationalIncidentsId({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetOperationalIncidentsQueryKey() });
        toast({ title: "Incident updated" });
        onClose();
      },
      onError: () => toast({ title: "Failed to update incident", variant: "destructive" }),
    },
  });

  const submit = () => {
    const payload = {
      title: form.title,
      description: form.description,
      category: form.category,
      severity: form.severity,
      status: form.status,
      affectedUsersCount: parseInt(form.affectedUsersCount, 10) || 0,
    };
    if (existing) {
      updateMutation.mutate({ id: existing.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  };

  const busy = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Incident" : "Create Incident"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Title</Label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Brief incident description" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Detailed context, affected systems, timeline…" rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v as IncidentCategory }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Severity</Label>
              <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v as IncidentSeverity }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as IncidentStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Affected Users</Label>
              <Input type="number" min="0" value={form.affectedUsersCount} onChange={(e) => setForm((f) => ({ ...f, affectedUsersCount: e.target.value }))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.title}>
            {busy ? "Saving…" : existing ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminIncidents() {
  const queryClient = useQueryClient();
  useOpsRealtimeTypes(["incident.updated"], () => {
    void queryClient.invalidateQueries({ queryKey: getGetOperationalIncidentsQueryKey() });
  });

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IncidentRow | null>(null);

  const { data, isLoading } = useGetOperationalIncidents(
    statusFilter !== "all" ? { status: statusFilter } : {},
  );
  const { toast } = useToast();

  const deleteMutation = useDeleteOperationalIncidentsId({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetOperationalIncidentsQueryKey() });
        toast({ title: "Incident deleted" });
      },
      onError: () => toast({ title: "Failed to delete incident", variant: "destructive" }),
    },
  });

  const incidents = ((data as Record<string, unknown>)?.incidents as IncidentRow[]) ?? [];

  return (
    <OpsShell
      title="Incidents"
      description="Track and manage operational incidents across BROKER, EA, SERVER, PAYMENT, MODEL, and NETWORK categories."
      actions={
        <Button onClick={() => setCreateOpen(true)} className="bg-cyan-900 hover:bg-cyan-800 text-cyan-50">
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Incident
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2 mb-2">
        {["all", "INCIDENT_OPEN", "INVESTIGATING", "RESOLVED"].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => setStatusFilter(s)}
            className={statusFilter === s ? "bg-cyan-900 text-cyan-50 hover:bg-cyan-800" : "border-cyan-900/50 text-cyan-50 hover:bg-cyan-900/20 bg-background/50"}
          >
            {s === "all" ? "All" : s.replace(/_/g, " ")}
          </Button>
        ))}
      </div>

      {isLoading && <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING INCIDENTS... ]</div>}

      {!isLoading && incidents.length === 0 && (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-cyan-500/30 mx-auto mb-3" />
            <p className="text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">[ No incidents in this category ]</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {incidents.map((inc) => (
          <Card key={inc.id} className={`border-cyan-900/40 bg-card/50 backdrop-blur ${inc.status === "INCIDENT_OPEN" ? "border-red-900/40" : inc.status === "INVESTIGATING" ? "border-yellow-900/40" : ""}`}>
            <CardContent className="py-4 px-5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2 font-mono uppercase tracking-wider">
                    <Badge className={`${STATUS_COLORS[inc.status]} border text-[10px]`}>
                      {inc.status.replace(/_/g, " ")}
                    </Badge>
                    <Badge className={`${SEV_COLORS[inc.severity]} border-0 text-[10px]`}>
                      {inc.severity}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] border-cyan-900/50 text-cyan-100/70 bg-background/50">{inc.category}</Badge>
                    {(inc.affectedUsersCount ?? 0) > 0 && (
                      <span className="text-[10px] text-cyan-500/70">{inc.affectedUsersCount} affected</span>
                    )}
                  </div>
                  <div className="font-semibold text-cyan-50">{inc.title}</div>
                  {inc.description && (
                    <p className="text-sm text-cyan-100/60 mt-1.5 line-clamp-2">{inc.description}</p>
                  )}
                  <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-500/50 mt-3 flex flex-wrap gap-2">
                    <span>Opened {timeAgo(inc.createdAt)}</span>
                    {inc.resolvedAt && (
                      <>
                        <span className="opacity-50">/</span>
                        <span>Resolved {timeAgo(inc.resolvedAt)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0 w-full sm:w-auto justify-end sm:justify-start mt-2 sm:mt-0">
                  <Button size="sm" variant="outline" className="h-8 border-cyan-900/50 text-cyan-50 bg-background/50 hover:bg-cyan-900/20" onClick={() => setEditTarget(inc)}>
                    <Edit className="w-3.5 h-3.5 mr-1.5" /> Edit
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 border-red-900/50 text-red-400 bg-background/50 hover:bg-red-950/40 hover:text-red-300"
                    onClick={() => deleteMutation.mutate({ id: inc.id })}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <IncidentDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {editTarget && (
        <IncidentDialog open={!!editTarget} onClose={() => setEditTarget(null)} existing={editTarget} />
      )}
    </OpsShell>
  );
}
