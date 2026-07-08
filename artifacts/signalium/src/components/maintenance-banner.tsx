import { AlertTriangle } from "lucide-react";
import { useGetActiveMaintenanceBanner } from "@workspace/api-client-react";

export function MaintenanceBanner() {
  const { data: banner } = useGetActiveMaintenanceBanner({
    query: { queryKey: ["maintenance-banner-active"], refetchInterval: 60_000 },
  });

  if (!banner) return null;

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 bg-warning/15 border-b border-warning/30 text-warning-foreground"
      data-testid="banner-maintenance"
    >
      <AlertTriangle className="w-4 h-4 shrink-0 text-warning" />
      <span className="text-sm">{banner.message}</span>
    </div>
  );
}
