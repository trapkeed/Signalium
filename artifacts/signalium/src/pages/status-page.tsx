import { useGetActiveStatus } from "@workspace/api-client-react";
import { PublicShell } from "@/components/public-shell";
import { CheckCircle2, AlertTriangle, XCircle, Wrench, Clock } from "lucide-react";
import type { ActiveStatus, StatusIncident } from "@workspace/api-client-react";

const STATUS_META: Record<ActiveStatus["status"], { label: string; icon: typeof CheckCircle2; className: string }> = {
  operational: { label: "All systems operational", icon: CheckCircle2, className: "text-success" },
  degraded: { label: "Degraded performance", icon: AlertTriangle, className: "text-yellow-500" },
  partial_outage: { label: "Partial outage", icon: AlertTriangle, className: "text-orange-500" },
  major_outage: { label: "Major outage", icon: XCircle, className: "text-destructive" },
  maintenance: { label: "Scheduled maintenance", icon: Wrench, className: "text-primary" },
};

const IMPACT_LABEL: Record<StatusIncident["impact"], string> = {
  minor: "Minor",
  major: "Major",
  critical: "Critical",
};

function IncidentCard({ incident }: { incident: StatusIncident }) {
  return (
    <div className="border border-white/10 bg-card rounded p-5">
      <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
        <span className="text-white font-medium">{incident.title}</span>
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="px-2 py-0.5 rounded bg-white/5 text-muted-foreground">{IMPACT_LABEL[incident.impact]}</span>
          <span className="px-2 py-0.5 rounded bg-primary/10 text-primary capitalize">{incident.status}</span>
        </div>
      </div>
      <p className="text-sm text-muted-foreground font-light">{incident.message}</p>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60 font-mono mt-3">
        <Clock className="w-3 h-3" />
        {new Date(incident.updatedAt).toLocaleString()}
      </div>
    </div>
  );
}

export default function StatusPage() {
  const { data, isLoading } = useGetActiveStatus();

  const meta = data ? STATUS_META[data.status] : STATUS_META.operational;
  const Icon = meta.icon;

  return (
    <PublicShell>
      <section className="max-w-3xl mx-auto px-6 py-20">
        <h1 className="text-3xl md:text-4xl font-normal text-white mb-8">System Status</h1>

        {isLoading ? (
          <div className="text-sm text-muted-foreground font-mono">Loading...</div>
        ) : (
          <>
            <div className="border border-white/10 bg-card rounded p-8 flex items-center gap-4 mb-10">
              <Icon className={`w-8 h-8 shrink-0 ${meta.className}`} />
              <div>
                <div className="text-xl text-white font-medium">{meta.label}</div>
                {data?.updatedAt && (
                  <div className="text-xs text-muted-foreground/60 font-mono mt-1">
                    Last updated {new Date(data.updatedAt).toLocaleString()}
                  </div>
                )}
              </div>
            </div>

            {data && data.incidents.length > 0 && (
              <div className="mb-10">
                <h2 className="text-sm text-primary tracking-widest uppercase mb-4">Ongoing incidents</h2>
                <div className="flex flex-col gap-3">
                  {data.incidents.map((i) => (
                    <IncidentCard key={i.id} incident={i} />
                  ))}
                </div>
              </div>
            )}

            {data && data.recentResolved.length > 0 && (
              <div>
                <h2 className="text-sm text-muted-foreground tracking-widest uppercase mb-4">Recently resolved</h2>
                <div className="flex flex-col gap-3">
                  {data.recentResolved.map((i) => (
                    <IncidentCard key={i.id} incident={i} />
                  ))}
                </div>
              </div>
            )}

            {data && data.incidents.length === 0 && data.recentResolved.length === 0 && (
              <p className="text-sm text-muted-foreground font-light">No incidents to report.</p>
            )}
          </>
        )}
      </section>
    </PublicShell>
  );
}
