import { useState } from "react";
import {
  exportComplianceAuditLog, useVerifyComplianceAuditChain,
  useListComplianceDataRequests, useGetComplianceRetentionPolicy,
} from "@workspace/api-client-react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OpsShell } from "@/components/ops/ops-shell";
import { ShieldCheck, ShieldAlert, Download } from "lucide-react";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-cyan-500/60 font-mono mb-1">{label}</div>
        <div className="text-xl font-bold text-cyan-50 font-mono">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function AdminCompliance() {
  const { data: chain, refetch: refetchChain, isFetching: verifying } = useVerifyComplianceAuditChain();
  const { data: requests } = useListComplianceDataRequests();
  const { data: retention } = useGetComplianceRetentionPolicy();
  const exportMutation = useMutation({ mutationFn: () => exportComplianceAuditLog() });
  const [exported, setExported] = useState<{ rowCount: number; exportedAt: string } | null>(null);

  async function handleExport() {
    const result = await exportMutation.mutateAsync();
    setExported({ rowCount: result.rowCount, exportedAt: result.exportedAt });
    const blob = new Blob([JSON.stringify(result.entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-export-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <OpsShell
      title="Compliance & Data Governance"
      description="Tamper-evidence for the audit trail, data export/deletion request oversight, and the platform's retention policy."
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Pending Deletions" value={requests?.deletions.filter((d) => d.status === "pending_confirmation" || d.status === "scheduled").length ?? "—"} />
        <StatCard label="Data Exports (recent)" value={requests?.exports.length ?? "—"} />
        <StatCard label="Audit Retention" value={retention ? `${retention.auditLogRetentionDays}d` : "—"} />
      </div>

      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-wider flex items-center gap-2">
            {chain?.ok === false ? <ShieldAlert className="w-4 h-4 text-destructive" /> : <ShieldCheck className="w-4 h-4 text-emerald-400" />}
            Audit Chain Integrity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chain ? (
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant={chain.ok ? "default" : "destructive"} className="font-mono text-[10px] uppercase">
                {chain.ok ? "Intact" : "Broken"}
              </Badge>
              <span className="text-xs text-cyan-500/70 font-mono">{chain.rowsChecked} rows checked</span>
              {!chain.ok && chain.brokenAt && (
                <span className="text-xs text-destructive font-mono">
                  break at sequence #{chain.brokenAt.sequenceNum} (id {chain.brokenAt.id})
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-cyan-500/50 font-mono">Loading…</span>
          )}
          <Button size="sm" variant="outline" className="mt-3 rounded-lg gap-2" onClick={() => refetchChain()} disabled={verifying}>
            {verifying ? "Verifying…" : "Re-verify chain"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-wider">Audit Log Export</CardTitle>
        </CardHeader>
        <CardContent>
          <Button size="sm" className="rounded-lg gap-2" onClick={handleExport} disabled={exportMutation.isPending}>
            <Download className="w-3.5 h-3.5" /> {exportMutation.isPending ? "Exporting…" : "Export full audit log (JSON)"}
          </Button>
          {exported && (
            <p className="text-xs text-cyan-500/60 font-mono mt-2">
              Last export: {exported.rowCount} rows at {new Date(exported.exportedAt).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardHeader><CardTitle className="text-sm font-mono uppercase tracking-wider">Account Deletion Requests</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-cyan-100/50 border-b border-cyan-900/30">
                    <th className="px-4 py-2">User</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Scheduled For</th>
                  </tr>
                </thead>
                <tbody>
                  {(requests?.deletions ?? []).map((d) => (
                    <tr key={d.id} className="border-b border-cyan-900/10 text-cyan-100">
                      <td className="px-4 py-2 truncate max-w-[140px]" title={d.userId}>{d.userId}</td>
                      <td className="px-4 py-2"><Badge variant="outline" className="text-[10px] font-mono">{d.status}</Badge></td>
                      <td className="px-4 py-2 text-cyan-500/70">{d.scheduledFor ? new Date(d.scheduledFor).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                  {(!requests || requests.deletions.length === 0) && (
                    <tr><td colSpan={3} className="px-4 py-6 text-center text-cyan-500/50">No deletion requests</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardHeader><CardTitle className="text-sm font-mono uppercase tracking-wider">Data Export Requests</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-cyan-100/50 border-b border-cyan-900/30">
                    <th className="px-4 py-2">User</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {(requests?.exports ?? []).map((e) => (
                    <tr key={e.id} className="border-b border-cyan-900/10 text-cyan-100">
                      <td className="px-4 py-2 truncate max-w-[140px]" title={e.userId}>{e.userId}</td>
                      <td className="px-4 py-2"><Badge variant={e.status === "completed" ? "default" : "destructive"} className="text-[10px] font-mono">{e.status}</Badge></td>
                      <td className="px-4 py-2 text-cyan-500/70">{new Date(e.requestedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {(!requests || requests.exports.length === 0) && (
                    <tr><td colSpan={3} className="px-4 py-6 text-center text-cyan-500/50">No export requests</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {retention && (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur mt-6">
          <CardHeader><CardTitle className="text-sm font-mono uppercase tracking-wider">Retention Policy</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-cyan-100/70">
              {retention.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </OpsShell>
  );
}
