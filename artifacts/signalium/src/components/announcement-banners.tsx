import { useState } from "react";
import { Megaphone, X } from "lucide-react";
import { useListAnnouncementBanners } from "@workspace/api-client-react";

export function AnnouncementBanners() {
  const { data: announcements = [] } = useListAnnouncementBanners({
    query: { queryKey: ["announcement-banners"], refetchInterval: 60_000 },
  });
  const [dismissed, setDismissed] = useState<number[]>([]);

  const visible = announcements.filter((a) => !dismissed.includes(a.id));

  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col">
      {visible.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-2.5 px-4 py-2.5 bg-primary/10 border-b border-primary/20"
          data-testid={`banner-announcement-${a.id}`}
        >
          <Megaphone className="w-4 h-4 shrink-0 text-primary" />
          <div className="flex-1 min-w-0 text-sm">
            <span className="font-medium text-foreground">{a.title}</span>
            <span className="text-muted-foreground"> — {a.body}</span>
          </div>
          <button
            onClick={() => setDismissed((d) => [...d, a.id])}
            className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary/60 shrink-0"
            aria-label="Dismiss announcement"
            data-testid={`button-dismiss-announcement-${a.id}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
