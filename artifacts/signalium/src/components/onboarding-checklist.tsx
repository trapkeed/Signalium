import { useGetOnboardingChecklist, useDismissOnboardingChecklist, getGetOnboardingChecklistQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2, Circle, X } from "lucide-react";
import { useState } from "react";

// S30 — first-login walkthrough / account-completion checklist. Computed
// live from real account state (subscription, API key, EA build, broker
// registration) server-side, so it can never show a false "done".
export function OnboardingChecklist() {
  const { data, isLoading } = useGetOnboardingChecklist();
  const dismiss = useDismissOnboardingChecklist();
  const queryClient = useQueryClient();
  const [hiddenLocally, setHiddenLocally] = useState(false);

  if (isLoading || !data || data.isComplete || hiddenLocally) return null;

  return (
    <div className="border border-border bg-card rounded-lg p-6 relative">
      <button
        aria-label="Dismiss checklist"
        className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
        onClick={() => {
          setHiddenLocally(true);
          dismiss.mutate(undefined, {
            onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetOnboardingChecklistQueryKey() }),
          });
        }}
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-center justify-between mb-4 pr-6">
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Get started</div>
          <div className="text-sm text-muted-foreground mt-0.5">{data.completedCount} of {data.totalCount} steps complete</div>
        </div>
        <div className="text-2xl font-bold tabular-nums">{data.percentComplete}%</div>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden mb-5">
        <div className="h-full bg-primary transition-all" style={{ width: `${data.percentComplete}%` }} />
      </div>
      <ul className="space-y-3">
        {data.steps.map((step) => (
          <li key={step.key} className="flex items-center gap-3">
            {step.completed ? (
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
            ) : (
              <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <span className={`text-sm ${step.completed ? "text-muted-foreground line-through" : ""}`}>{step.title}</span>
            {!step.completed && (
              <Link href={step.guide} className="text-xs text-primary hover:underline ml-auto shrink-0">
                Go →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
