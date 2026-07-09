import { FlaskConical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * S24B — shared "Research Lab unavailable" state.
 *
 * Rendered whenever signalium-trainer's Research Lab API is not configured
 * or unreachable (backend returns 503 { error: "research_lab_unavailable" }).
 * Never render mocked/fabricated data instead of this — and never surface
 * the raw error body, stack trace, or internal trainer URL to the UI.
 */
export function ResearchLabUnavailable({ label }: { label?: string }) {
  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardContent className="py-12 text-center">
        <FlaskConical className="w-8 h-8 text-cyan-500/30 mx-auto mb-3" />
        <p className="text-[11px] uppercase tracking-wider font-mono text-cyan-500/50">
          [ Research Lab unavailable{label ? ` — ${label}` : ""} ]
        </p>
        <p className="text-[10px] font-mono text-cyan-500/40 mt-1 uppercase">
          signalium-trainer's Research Lab API is not configured or not reachable.
        </p>
      </CardContent>
    </Card>
  );
}

/** True when an orval/react-query error represents a research-lab-unavailable 503. */
export function isResearchLabUnavailable(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 503;
}
