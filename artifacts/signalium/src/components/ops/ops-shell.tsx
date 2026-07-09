import { ReactNode } from "react";
import { Radio, RadioTower } from "lucide-react";
import { useOpsConnectionStatus } from "@/hooks/use-ops-realtime";
import { cn } from "@/lib/utils";

/**
 * Shared shell for the admin ops surface (S23d). Scoped ONLY to the ops
 * pages (operations, platform-health, ea-monitor, incidents, alerts,
 * symbol-health, security-operations, audit-log, deployments) — gives them
 * a distinct dark-futuristic "mission control" identity separate from the
 * rest of the (already dark, gold-accented) admin panel: a cyan signal
 * glow, scanline texture, and monospace telemetry readouts.
 *
 * Usage:
 *   <OpsShell title="Operations Dashboard" description="...">
 *     ...page content...
 *   </OpsShell>
 */

export function LiveStatusBadge({ className }: { className?: string }) {
  const connected = useOpsConnectionStatus();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider shrink-0",
        connected
          ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
          : "border-muted-foreground/20 bg-muted/30 text-muted-foreground",
        className,
      )}
      title={connected ? "Live updates connected" : "Live updates unavailable — falling back to polling"}
    >
      {connected ? (
        <RadioTower className="h-3 w-3 animate-pulse" />
      ) : (
        <Radio className="h-3 w-3" />
      )}
      {connected ? "Live" : "Polling"}
    </span>
  );
}

export function OpsShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-full">
      {/* Ambient ops-only backdrop: faint cyan glow + scanline grid, distinct from the rest of the app */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.6) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -top-40 left-1/2 z-0 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-3xl"
      />

      <div className="relative z-10 space-y-6 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
              <LiveStatusBadge />
            </div>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>

        {children}
      </div>
    </div>
  );
}
