import { useState } from "react";
import {
  useGetOperationalAlerts,
  useGetOperationalRiskAlerts,
  usePostOperationalAlertsIdAcknowledge,
  usePostOperationalRiskAlertsIdAcknowledge,
  useGetOperationalAlertChannels,
  usePatchOperationalAlertChannels,
} from "@workspace/api-client-react";
import {
  getGetOperationalAlertsQueryKey,
  getGetOperationalRiskAlertsQueryKey,
  getGetOperationalAlertChannelsQueryKey,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bell, BellOff, AlertTriangle, CheckCircle2, TrendingDown, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

function timeAgo(v: string | null | undefined) {
  if (!v) return "—";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

type AlertSeverity = "info" | "warning" | "critical";
type RiskSeverity = "warning" | "critical";

const SEVERITY_STYLES: Record<AlertSeverity, string> = {
  info:     "bg-blue-500/10 text-blue-400 border-blue-500/20",
  warning:  "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  critical: "bg-red-500/10 text-red-400 border-red-500/20",
};

const RISK_SEV_STYLES: Record<RiskSeverity, string> = {
  warning:  "bg-yellow-500/10 text-yellow-400",
  critical: "bg-red-500/10 text-red-400",
};

const DELIVERY_STYLES: Record<string, string> = {
  sent: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
  skipped: "bg-muted text-muted-foreground",
  not_configured: "bg-muted text-muted-foreground border-dashed",
};

const RISK_ALERT_LABELS: Record<string, string> = {
  daily_drawdown: "Daily Drawdown",
  weekly_drawdown: "Weekly Drawdown",
  margin_stress: "Margin Stress",
  exposure_concentration: "Exposure Concentration",
  abnormal_frequency: "Abnormal Trade Frequency",
};

// ─── Platform Alerts Tab ──────────────────────────────────────────────────────

function PlatformAlertsTab() {
  const [filter, setFilter] = useState<"all" | "unacked">("unacked");
  const { data, isLoading } = useGetOperationalAlerts(
    filter === "unacked" ? { unacknowledged: "true" } : {},
  );
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ackMutation = usePostOperationalAlertsIdAcknowledge({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetOperationalAlertsQueryKey() });
        toast({ title: "Alert acknowledged" });
      },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    },
  });

  const d = data as Record<string, unknown> | undefined;
  const alerts = (d?.alerts as Array<Record<string, unknown>>) ?? [];
  const unackCount = d?.unacknowledgedCount as number ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button size="sm" variant={filter === "unacked" ? "default" : "outline"} onClick={() => setFilter("unacked")}>
            Unacknowledged {unackCount > 0 && <Badge variant="destructive" className="ml-1 text-xs">{unackCount}</Badge>}
          </Button>
          <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
            All
          </Button>
        </div>
      </div>

      {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}

      {!isLoading && alerts.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No alerts to show.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {alerts.map((a) => (
          <Card key={a.id as number} className={`border ${SEVERITY_STYLES[a.severity as AlertSeverity] ?? ""}`}>
            <CardContent className="py-3 px-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={`${SEVERITY_STYLES[a.severity as AlertSeverity]} border text-xs`}>
                      {a.severity as string}
                    </Badge>
                    <span className="text-xs font-medium capitalize">{(a.type as string).replace(/_/g, " ")}</span>
                  </div>
                  <p className="text-sm">{a.message as string}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    <span>{timeAgo(a.createdAt as string)}</span>
                    {a.userId != null && <span>User: {String(a.userId)}</span>}
                    {!!a.acknowledged && <span className="text-emerald-400">✓ Acknowledged {timeAgo(a.acknowledgedAt as string | null)}</span>}
                  </div>
                  {Array.isArray(a.delivery) && (a.delivery as Array<Record<string, unknown>>).length > 0 && (
                    <div className="flex items-center gap-1.5 mt-2">
                      {(a.delivery as Array<Record<string, unknown>>).map((d) => (
                        <Badge
                          key={d.channel as string}
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${DELIVERY_STYLES[d.status as string] ?? ""}`}
                          title={(d.detail as string | null) ?? undefined}
                        >
                          {d.channel as string}: {(d.status as string).replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                {!a.acknowledged && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => ackMutation.mutate({ id: a.id as number })}
                    disabled={ackMutation.isPending}
                  >
                    <BellOff className="w-3.5 h-3.5 mr-1" />
                    Acknowledge
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Risk Alerts Tab ──────────────────────────────────────────────────────────

function RiskAlertsTab() {
  const [filter, setFilter] = useState<"all" | "unacked">("unacked");
  const { data, isLoading } = useGetOperationalRiskAlerts(
    filter === "unacked" ? { unacknowledged: "true" } : {},
  );
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ackMutation = usePostOperationalRiskAlertsIdAcknowledge({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetOperationalRiskAlertsQueryKey() });
        toast({ title: "Alert acknowledged" });
      },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    },
  });

  const d = data as Record<string, unknown> | undefined;
  const alerts = (d?.alerts as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant={filter === "unacked" ? "default" : "outline"} onClick={() => setFilter("unacked")}>Unacknowledged</Button>
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All</Button>
      </div>

      {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}

      {!isLoading && alerts.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No risk alerts.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {alerts.map((a) => (
          <Card key={a.id as number}>
            <CardContent className="py-3 px-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={`${RISK_SEV_STYLES[a.severity as RiskSeverity] ?? ""} border-0 text-xs`}>
                      {a.severity as string}
                    </Badge>
                    <span className="text-xs font-medium">
                      {RISK_ALERT_LABELS[a.alertType as string] ?? a.alertType as string}
                    </span>
                  </div>
                  <p className="text-sm">{a.message as string}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    <span>{timeAgo(a.createdAt as string)}</span>
                    {a.currentValue != null && a.thresholdValue != null && (
                      <span>
                        Value: {(a.currentValue as number).toFixed(2)} / Threshold: {(a.thresholdValue as number).toFixed(2)}
                      </span>
                    )}
                    {a.userId != null && <span>User: {String(a.userId)}</span>}
                  </div>
                </div>
                {!a.acknowledged && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => ackMutation.mutate({ id: a.id as number })}
                    disabled={ackMutation.isPending}
                  >
                    <BellOff className="w-3.5 h-3.5 mr-1" />
                    Ack
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Delivery Channel Settings Tab ─────────────────────────────────────────────

function ChannelSettingsTab() {
  const { data, isLoading } = useGetOperationalAlertChannels();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [recipientsInput, setRecipientsInput] = useState<string | null>(null);

  const settings = data as Record<string, unknown> | undefined;

  const updateMutation = usePatchOperationalAlertChannels({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetOperationalAlertChannelsQueryKey() });
        toast({ title: "Alert channel settings updated" });
      },
      onError: () => toast({ title: "Failed to update settings", variant: "destructive" }),
    },
  });

  if (isLoading || !settings) return <div className="text-muted-foreground text-sm">Loading…</div>;

  const recipients = (settings.emailRecipients as string[] | undefined) ?? [];
  const recipientsValue = recipientsInput ?? recipients.join(", ");

  return (
    <div className="space-y-4 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="email-enabled">Enabled</Label>
            <Switch
              id="email-enabled"
              checked={Boolean(settings.emailEnabled)}
              onCheckedChange={(checked) => updateMutation.mutate({ data: { emailEnabled: checked } })}
            />
          </div>
          <div>
            <Label htmlFor="email-recipients" className="text-xs text-muted-foreground">Recipients (comma-separated)</Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="email-recipients"
                value={recipientsValue}
                onChange={(e) => setRecipientsInput(e.target.value)}
              />
              <Button
                size="sm"
                onClick={() => {
                  const list = recipientsValue.split(",").map((s) => s.trim()).filter(Boolean);
                  updateMutation.mutate({ data: { emailRecipients: list } });
                  setRecipientsInput(null);
                }}
                disabled={updateMutation.isPending}
              >
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Telegram
            {!settings.telegramConfigured && (
              <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground border-dashed">not configured</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="telegram-enabled">Enabled</Label>
            <Switch
              id="telegram-enabled"
              checked={Boolean(settings.telegramEnabled)}
              onCheckedChange={(checked) => updateMutation.mutate({ data: { telegramEnabled: checked } })}
            />
          </div>
          {!settings.telegramConfigured && (
            <p className="text-xs text-muted-foreground">Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID secrets to activate delivery.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Discord
            {!settings.discordConfigured && (
              <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground border-dashed">not configured</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="discord-enabled">Enabled</Label>
            <Switch
              id="discord-enabled"
              checked={Boolean(settings.discordEnabled)}
              onCheckedChange={(checked) => updateMutation.mutate({ data: { discordEnabled: checked } })}
            />
          </div>
          {!settings.discordConfigured && (
            <p className="text-xs text-muted-foreground">Add a DISCORD_WEBHOOK_URL secret to activate delivery.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminAlerts() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell className="w-6 h-6 text-yellow-400" />
          Alerts
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Platform-wide operational alerts and per-user risk threshold breaches.
        </p>
      </div>

      <Tabs defaultValue="platform">
        <TabsList className="mb-6">
          <TabsTrigger value="platform" className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />Platform Alerts
          </TabsTrigger>
          <TabsTrigger value="risk" className="flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5" />Risk Alerts
          </TabsTrigger>
          <TabsTrigger value="channels" className="flex items-center gap-1.5">
            <Settings2 className="w-3.5 h-3.5" />Delivery Channels
          </TabsTrigger>
        </TabsList>
        <TabsContent value="platform"><PlatformAlertsTab /></TabsContent>
        <TabsContent value="risk"><RiskAlertsTab /></TabsContent>
        <TabsContent value="channels"><ChannelSettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
