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
import { OpsShell } from "@/components/ops/ops-shell";
import { useOpsRealtimeTypes } from "@/hooks/use-ops-realtime";

function timeAgo(v: string | null | undefined) {
  if (!v) return "—";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

type AlertSeverity = "info" | "warning" | "critical";
type RiskSeverity = "warning" | "critical";

const SEVERITY_STYLES: Record<AlertSeverity, string> = {
  info:     "bg-cyan-950/30 text-cyan-400 border-cyan-900/50",
  warning:  "bg-yellow-950/30 text-yellow-400 border-yellow-900/50",
  critical: "bg-red-950/30 text-red-400 border-red-900/50",
};

const RISK_SEV_STYLES: Record<RiskSeverity, string> = {
  warning:  "bg-yellow-950/50 text-yellow-400",
  critical: "bg-red-950/50 text-red-400",
};

const DELIVERY_STYLES: Record<string, string> = {
  sent: "bg-emerald-950/30 text-emerald-400 border-emerald-900/50",
  failed: "bg-red-950/30 text-red-400 border-red-900/50",
  skipped: "bg-background/50 text-cyan-500/50 border-cyan-900/30",
  not_configured: "bg-background/50 text-cyan-500/50 border-cyan-900/30 border-dashed",
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
      onError: () => toast({ title: "Failed to acknowledge alert", variant: "destructive" }),
    },
  });

  const d = data as Record<string, unknown> | undefined;
  const alerts = (d?.alerts as Array<Record<string, unknown>>) ?? [];
  const unackCount = d?.unacknowledgedCount as number ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex gap-2 w-full sm:w-auto">
          <Button size="sm" className={`flex-1 sm:flex-none ${filter === "unacked" ? "bg-cyan-900 text-cyan-50 hover:bg-cyan-800" : "border-cyan-900/50 text-cyan-50 hover:bg-cyan-900/20 bg-background/50"}`} variant={filter === "unacked" ? "default" : "outline"} onClick={() => setFilter("unacked")}>
            Unacknowledged {unackCount > 0 && <Badge variant="destructive" className="ml-1 text-[10px] font-mono">{unackCount}</Badge>}
          </Button>
          <Button size="sm" className={`flex-1 sm:flex-none ${filter === "all" ? "bg-cyan-900 text-cyan-50 hover:bg-cyan-800" : "border-cyan-900/50 text-cyan-50 hover:bg-cyan-900/20 bg-background/50"}`} variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
            All
          </Button>
        </div>
      </div>

      {isLoading && <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING ALERTS... ]</div>}

      {!isLoading && alerts.length === 0 && (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-cyan-500/30 mx-auto mb-3" />
            <p className="text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">[ No alerts to show ]</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {alerts.map((a) => (
          <Card key={a.id as number} className={`border-cyan-900/40 bg-card/50 backdrop-blur border ${SEVERITY_STYLES[a.severity as AlertSeverity] ?? ""}`}>
            <CardContent className="py-3 px-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 font-mono uppercase tracking-wider">
                    <Badge className={`${SEVERITY_STYLES[a.severity as AlertSeverity]} border text-[10px]`}>
                      {a.severity as string}
                    </Badge>
                    <span className="text-[11px] font-bold text-cyan-50">{(a.type as string).replace(/_/g, " ")}</span>
                  </div>
                  <p className="text-sm text-cyan-100/80">{a.message as string}</p>
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] font-mono uppercase tracking-wider text-cyan-500/50">
                    <span>{timeAgo(a.createdAt as string)}</span>
                    {a.userId != null && (
                      <>
                        <span className="opacity-50">/</span>
                        <span>User: {String(a.userId)}</span>
                      </>
                    )}
                    {!!a.acknowledged && (
                      <>
                        <span className="opacity-50">/</span>
                        <span className="text-emerald-400">✓ Ack {timeAgo(a.acknowledgedAt as string | null)}</span>
                      </>
                    )}
                  </div>
                  {Array.isArray(a.delivery) && (a.delivery as Array<Record<string, unknown>>).length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {(a.delivery as Array<Record<string, unknown>>).map((d) => (
                        <Badge
                          key={d.channel as string}
                          variant="outline"
                          className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0 ${DELIVERY_STYLES[d.status as string] ?? ""}`}
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
                    className="shrink-0 w-full sm:w-auto h-8 border-cyan-900/50 text-cyan-50 bg-background/50 hover:bg-cyan-900/20"
                    onClick={() => ackMutation.mutate({ id: a.id as number })}
                    disabled={ackMutation.isPending}
                  >
                    <BellOff className="w-3.5 h-3.5 mr-1.5" />
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
      onError: () => toast({ title: "Failed to acknowledge risk alert", variant: "destructive" }),
    },
  });

  const d = data as Record<string, unknown> | undefined;
  const alerts = (d?.alerts as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" className={`flex-1 sm:flex-none ${filter === "unacked" ? "bg-cyan-900 text-cyan-50 hover:bg-cyan-800" : "border-cyan-900/50 text-cyan-50 hover:bg-cyan-900/20 bg-background/50"}`} variant={filter === "unacked" ? "default" : "outline"} onClick={() => setFilter("unacked")}>Unacknowledged</Button>
        <Button size="sm" className={`flex-1 sm:flex-none ${filter === "all" ? "bg-cyan-900 text-cyan-50 hover:bg-cyan-800" : "border-cyan-900/50 text-cyan-50 hover:bg-cyan-900/20 bg-background/50"}`} variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All</Button>
      </div>

      {isLoading && <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING ALERTS... ]</div>}

      {!isLoading && alerts.length === 0 && (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-cyan-500/30 mx-auto mb-3" />
            <p className="text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">[ No risk alerts ]</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {alerts.map((a) => (
          <Card key={a.id as number} className="border-cyan-900/40 bg-card/50 backdrop-blur">
            <CardContent className="py-3 px-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 font-mono uppercase tracking-wider">
                    <Badge className={`${RISK_SEV_STYLES[a.severity as RiskSeverity] ?? ""} border-0 text-[10px]`}>
                      {a.severity as string}
                    </Badge>
                    <span className="text-[11px] font-bold text-cyan-50">
                      {RISK_ALERT_LABELS[a.alertType as string] ?? a.alertType as string}
                    </span>
                  </div>
                  <p className="text-sm text-cyan-100/80">{a.message as string}</p>
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] font-mono uppercase tracking-wider text-cyan-500/50">
                    <span>{timeAgo(a.createdAt as string)}</span>
                    {a.currentValue != null && a.thresholdValue != null && (
                      <>
                        <span className="opacity-50">/</span>
                        <span>
                          VAL: {(a.currentValue as number).toFixed(2)} | THR: {(a.thresholdValue as number).toFixed(2)}
                        </span>
                      </>
                    )}
                    {a.userId != null && (
                      <>
                        <span className="opacity-50">/</span>
                        <span>User: {String(a.userId)}</span>
                      </>
                    )}
                  </div>
                </div>
                {!a.acknowledged && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 w-full sm:w-auto h-8 border-cyan-900/50 text-cyan-50 bg-background/50 hover:bg-cyan-900/20"
                    onClick={() => ackMutation.mutate({ id: a.id as number })}
                    disabled={ackMutation.isPending}
                  >
                    <BellOff className="w-3.5 h-3.5 mr-1.5" />
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

  if (isLoading || !settings) return <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING SETTINGS... ]</div>;

  const recipients = (settings.emailRecipients as string[] | undefined) ?? [];
  const recipientsValue = recipientsInput ?? recipients.join(", ");

  return (
    <div className="space-y-4 max-w-xl">
      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-cyan-50">Email</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="email-enabled" className="text-cyan-50">Enabled</Label>
            <Switch
              id="email-enabled"
              checked={Boolean(settings.emailEnabled)}
              onCheckedChange={(checked) => updateMutation.mutate({ data: { emailEnabled: checked } })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email-recipients" className="text-[10px] font-mono uppercase tracking-wider text-cyan-500/70">Recipients (comma-separated)</Label>
            <div className="flex flex-col sm:flex-row gap-2 mt-1">
              <Input
                id="email-recipients"
                value={recipientsValue}
                onChange={(e) => setRecipientsInput(e.target.value)}
                className="bg-background/50 border-cyan-900/30 text-cyan-50 font-mono text-xs w-full"
              />
              <Button
                size="sm"
                onClick={() => {
                  const list = recipientsValue.split(",").map((s) => s.trim()).filter(Boolean);
                  updateMutation.mutate({ data: { emailRecipients: list } });
                  setRecipientsInput(null);
                }}
                disabled={updateMutation.isPending}
                className="bg-cyan-900 hover:bg-cyan-800 text-cyan-50 w-full sm:w-auto"
              >
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-cyan-50 flex items-center gap-2">
            Telegram
            {!settings.telegramConfigured && (
              <Badge variant="outline" className="text-[10px] bg-background/50 text-cyan-500/50 border-cyan-900/30 border-dashed">not configured</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="telegram-enabled" className="text-cyan-50">Enabled</Label>
            <Switch
              id="telegram-enabled"
              checked={Boolean(settings.telegramEnabled)}
              onCheckedChange={(checked) => updateMutation.mutate({ data: { telegramEnabled: checked } })}
            />
          </div>
          {!settings.telegramConfigured && (
            <p className="text-[10px] font-mono text-cyan-500/50">Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID secrets to activate delivery.</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-cyan-50 flex items-center gap-2">
            Discord
            {!settings.discordConfigured && (
              <Badge variant="outline" className="text-[10px] bg-background/50 text-cyan-500/50 border-cyan-900/30 border-dashed">not configured</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="discord-enabled" className="text-cyan-50">Enabled</Label>
            <Switch
              id="discord-enabled"
              checked={Boolean(settings.discordEnabled)}
              onCheckedChange={(checked) => updateMutation.mutate({ data: { discordEnabled: checked } })}
            />
          </div>
          {!settings.discordConfigured && (
            <p className="text-[10px] font-mono text-cyan-500/50">Add a DISCORD_WEBHOOK_URL secret to activate delivery.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminAlerts() {
  const queryClient = useQueryClient();
  useOpsRealtimeTypes(["alert.new"], () => {
    void queryClient.invalidateQueries({ queryKey: getGetOperationalAlertsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetOperationalRiskAlertsQueryKey() });
  });

  return (
    <OpsShell
      title="Alerts"
      description="Platform-wide operational alerts and per-user risk threshold breaches."
    >
      <Tabs defaultValue="platform" className="mt-4">
        <TabsList className="mb-6 bg-cyan-950/20 border border-cyan-900/30 p-1 flex-wrap h-auto w-full justify-start">
          <TabsTrigger value="platform" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider data-[state=active]:bg-cyan-900/50 data-[state=active]:text-cyan-50">
            <AlertTriangle className="w-3.5 h-3.5" />Platform Alerts
          </TabsTrigger>
          <TabsTrigger value="risk" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider data-[state=active]:bg-cyan-900/50 data-[state=active]:text-cyan-50">
            <TrendingDown className="w-3.5 h-3.5" />Risk Alerts
          </TabsTrigger>
          <TabsTrigger value="channels" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider data-[state=active]:bg-cyan-900/50 data-[state=active]:text-cyan-50">
            <Settings2 className="w-3.5 h-3.5" />Delivery Channels
          </TabsTrigger>
        </TabsList>
        <TabsContent value="platform"><PlatformAlertsTab /></TabsContent>
        <TabsContent value="risk"><RiskAlertsTab /></TabsContent>
        <TabsContent value="channels"><ChannelSettingsTab /></TabsContent>
      </Tabs>
    </OpsShell>
  );
}
