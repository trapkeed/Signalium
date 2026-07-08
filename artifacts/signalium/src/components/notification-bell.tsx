import { Bell, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  useListNotifications,
  useGetUnreadNotificationCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "@workspace/api-client-react";
import type { Notification } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function typeDotClass(type: Notification["type"]): string {
  switch (type) {
    case "security":
      return "bg-destructive";
    case "billing":
      return "bg-chart-3";
    case "announcement":
      return "bg-primary";
    default:
      return "bg-muted-foreground";
  }
}

export function NotificationBell() {
  const queryClient = useQueryClient();
  const { data: notifications = [] } = useListNotifications({
    query: { queryKey: ["notifications"], refetchInterval: 60_000 },
  });
  const { data: unread } = useGetUnreadNotificationCount({
    query: { queryKey: ["notifications-unread-count"], refetchInterval: 60_000 },
  });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unreadCount = unread?.count ?? 0;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
  }

  async function handleOpenNotification(n: Notification) {
    if (!n.isRead) {
      await markRead.mutateAsync({ id: n.id });
      invalidate();
    }
  }

  async function handleMarkAllRead() {
    await markAllRead.mutateAsync();
    invalidate();
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          aria-label="Notifications"
          data-testid="button-notification-bell"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unreadCount > 0 && <Badge variant="secondary">{unreadCount}</Badge>}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={handleMarkAllRead}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-96">
          {notifications.length === 0 ? (
            <div className="py-10 px-4 text-center text-sm text-muted-foreground">
              You're all caught up.
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleOpenNotification(n)}
                  className={cn(
                    "flex items-start gap-2.5 px-3 py-2.5 text-left border-b border-border/50 last:border-0 hover:bg-secondary/40 transition-colors",
                    !n.isRead && "bg-primary/5",
                  )}
                  data-testid={`notification-item-${n.id}`}
                >
                  <span className={cn("mt-1.5 w-1.5 h-1.5 rounded-full shrink-0", typeDotClass(n.type))} />
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-sm truncate", n.isRead ? "text-muted-foreground" : "text-foreground font-medium")}>
                      {n.title}
                    </div>
                    {n.body && (
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</div>
                    )}
                    <div className="text-[11px] text-muted-foreground/70 mt-1">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
