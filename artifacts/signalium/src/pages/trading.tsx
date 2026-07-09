import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTradingSettings,
  useUpdateTradingSettings,
  useListUserSymbols,
  useAddUserSymbol,
  useRemoveUserSymbol,
  useListSymbols,
  useGetMyEntitlements,
  getGetTradingSettingsQueryKey,
  getListUserSymbolsQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, CheckCircle2, TrendingUp, Bot, ShieldCheck, BarChart2 } from "lucide-react";
import type { UserSymbol } from "@workspace/api-client-react";

interface TradingProps {
  embedded?: boolean;
}

function parseApiError(err: unknown): { code?: string; message: string } {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: { data?: { code?: string; error?: string } } }).response;
    return {
      code: response?.data?.code,
      message: response?.data?.error ?? "An error occurred",
    };
  }
  return { message: err instanceof Error ? err.message : "An error occurred" };
}

// Group UserSymbol rows by category
function groupByCategory(symbols: UserSymbol[]) {
  const groups: Record<string, { categoryName: string; categorySlug: string; symbols: UserSymbol[] }> = {};
  for (const s of symbols) {
    if (!groups[s.categorySlug]) {
      groups[s.categorySlug] = { categoryName: s.categoryName, categorySlug: s.categorySlug, symbols: [] };
    }
    groups[s.categorySlug].symbols.push(s);
  }
  return Object.values(groups).sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}

type RiskParams = { lotSize?: number; stopLossPips?: number; takeProfitPips?: number; maxDailyLossPct?: number };

export default function Trading({ embedded }: TradingProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingMode, setPendingMode] = useState<"manual" | "autonomous" | null>(null);
  const [pendingRisk, setPendingRisk] = useState<"manual" | "qde" | null>(null);
  const [riskForm, setRiskForm] = useState<RiskParams>({});
  const [riskFormDirty, setRiskFormDirty] = useState(false);
  const [savingRiskParams, setSavingRiskParams] = useState(false);

  function invalidateSettings() {
    queryClient.invalidateQueries({ queryKey: getGetTradingSettingsQueryKey() });
  }
  function invalidateSymbols() {
    queryClient.invalidateQueries({ queryKey: getListUserSymbolsQueryKey() });
  }

  const { data: settings, isLoading: settingsLoading } = useGetTradingSettings();
  const { data: entitlement } = useGetMyEntitlements();
  const { data: userSymbols = [], isLoading: symbolsLoading } = useListUserSymbols();
  const { data: allSymbols = [] } = useListSymbols();

  const updateSettings = useUpdateTradingSettings();
  const addSymbol = useAddUserSymbol();
  const removeSymbol = useRemoveUserSymbol();

  const currentMode = settings?.tradingMode ?? "manual";
  const currentRisk = settings?.riskMode ?? "manual";
  const autonomousAllowed = entitlement?.autonomousAllowed ?? false;

  useEffect(() => {
    if (settings && !riskFormDirty) {
      setRiskForm((settings as { riskParams?: RiskParams }).riskParams ?? {});
    }
  }, [settings, riskFormDirty]);

  async function handleSaveRiskParams() {
    setSavingRiskParams(true);
    try {
      await updateSettings.mutateAsync({ data: { riskParams: riskForm } });
      invalidateSettings();
      setRiskFormDirty(false);
      toast({ title: "Risk parameters saved", description: "These values will be used for your manual-risk trades." });
    } catch (err) {
      const { message } = parseApiError(err);
      toast({ title: "Could not save risk parameters", description: message, variant: "destructive" });
    } finally {
      setSavingRiskParams(false);
    }
  }

  function updateRiskField(field: keyof RiskParams, value: string) {
    setRiskFormDirty(true);
    setRiskForm((prev) => ({ ...prev, [field]: value === "" ? undefined : Number(value) }));
  }

  const userSymbolIds = new Set((userSymbols as UserSymbol[]).map((s) => s.symbolId));
  const symbolGroups = groupByCategory(userSymbols as UserSymbol[]);

  // Group all available symbols by category for the selection grid
  const availableGroups: Record<string, { categoryName: string; symbols: typeof allSymbols }> = {};
  for (const s of allSymbols) {
    if (!s.enabled) continue;
    if (!availableGroups[s.categorySlug]) {
      availableGroups[s.categorySlug] = { categoryName: s.categoryName, symbols: [] };
    }
    availableGroups[s.categorySlug].symbols.push(s);
  }
  const sortedAvailableGroups = Object.entries(availableGroups).sort(([, a], [, b]) =>
    a.categoryName.localeCompare(b.categoryName),
  );

  async function handleModeToggle(newMode: "manual" | "autonomous") {
    if (newMode === currentMode) return;
    if (newMode === "autonomous" && !autonomousAllowed) {
      toast({
        title: "Plan upgrade required",
        description: "Autonomous trading is only available on Professional and Enterprise plans.",
        variant: "destructive",
      });
      return;
    }
    setPendingMode(newMode);
    try {
      await updateSettings.mutateAsync({ data: { tradingMode: newMode } });
      invalidateSettings();
      toast({
        title: newMode === "autonomous" ? "Autonomous mode enabled" : "Manual mode enabled",
        description:
          newMode === "autonomous"
            ? "The QDE will now manage your trades on selected symbols."
            : "You are now in manual mode. The QDE will provide signals only.",
      });
    } catch (err) {
      const { message } = parseApiError(err);
      toast({ title: "Could not update trading mode", description: message, variant: "destructive" });
    } finally {
      setPendingMode(null);
    }
  }

  async function handleRiskToggle(newRisk: "manual" | "qde") {
    if (newRisk === currentRisk) return;
    setPendingRisk(newRisk);
    try {
      await updateSettings.mutateAsync({ data: { riskMode: newRisk } });
      invalidateSettings();
      toast({
        title: newRisk === "qde" ? "QDE risk management enabled" : "Manual risk management enabled",
        description:
          newRisk === "qde"
            ? "The QDE will dynamically manage position size, exposure, and drawdown."
            : "You control risk parameters: lot size, stop loss, and take profit.",
      });
    } catch (err) {
      const { message } = parseApiError(err);
      toast({ title: "Could not update risk mode", description: message, variant: "destructive" });
    } finally {
      setPendingRisk(null);
    }
  }

  async function handleSymbolToggle(symbolId: number, isSelected: boolean) {
    if (isSelected) {
      try {
        await removeSymbol.mutateAsync({ symbolId });
        invalidateSymbols();
      } catch (err) {
        const { message } = parseApiError(err);
        toast({ title: "Could not remove symbol", description: message, variant: "destructive" });
      }
    } else {
      try {
        await addSymbol.mutateAsync({ data: { symbolId } });
        invalidateSymbols();
      } catch (err) {
        const { code, message } = parseApiError(err);
        if (code === "SYMBOL_LIMIT_REACHED") {
          toast({
            title: "Symbol limit reached",
            description: message + " Upgrade your plan to monitor more symbols.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Could not add symbol", description: message, variant: "destructive" });
        }
      }
    }
  }

  return (
    <div className={embedded ? "" : "flex-1 flex flex-col min-w-0 overflow-y-auto"}>
      {!embedded && (
        <div className="px-4 sm:px-8 py-6 border-b border-border">
          <h1 className="text-2xl font-bold tracking-tight">Trading Control Plane</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure your trading mode, monitored symbols, and risk management preferences
          </p>
        </div>
      )}

      <div className={embedded ? "" : "p-4 sm:p-8"}>
        <div className="flex flex-col gap-6 max-w-3xl">
          {/* Trading Mode Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Trading Mode</CardTitle>
              </div>
              <CardDescription>
                Choose how Signalium operates your account. In Manual mode, you receive signals and
                place trades yourself. In Autonomous mode, the QDE executes trades on your behalf.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Manual Mode */}
                <button
                  onClick={() => handleModeToggle("manual")}
                  disabled={settingsLoading || pendingMode !== null}
                  className={`relative rounded-lg border-2 p-4 text-left transition-colors ${
                    currentMode === "manual"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/50"
                  }`}
                >
                  {currentMode === "manual" && (
                    <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-primary" />
                  )}
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">Manual</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    You receive signals, bias, entry zones, and confidence scores. You place and
                    manage trades yourself.
                  </p>
                </button>

                {/* Autonomous Mode */}
                <button
                  onClick={() => handleModeToggle("autonomous")}
                  disabled={settingsLoading || pendingMode !== null || !autonomousAllowed}
                  className={`relative rounded-lg border-2 p-4 text-left transition-colors ${
                    currentMode === "autonomous"
                      ? "border-primary bg-primary/5"
                      : autonomousAllowed
                        ? "border-border hover:border-muted-foreground/50"
                        : "border-border opacity-50 cursor-not-allowed"
                  }`}
                >
                  {currentMode === "autonomous" && (
                    <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-primary" />
                  )}
                  {!autonomousAllowed && (
                    <span className="absolute top-3 right-3">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        Upgrade
                      </Badge>
                    </span>
                  )}
                  <div className="flex items-center gap-2 mb-2">
                    <Bot className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">Autonomous</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The QDE monitors markets, opens positions, manages stops, scales, and closes
                    trades. Your EA becomes execution-only.
                  </p>
                </button>
              </div>

              {currentMode === "autonomous" && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
                  <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Autonomous mode is active. The QDE will send trade instructions to your connected
                    MT5 terminal. Ensure your EA is running and connected.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Risk Management Card — only when autonomous */}
          {currentMode === "autonomous" && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">Risk Management</CardTitle>
                </div>
                <CardDescription>
                  In Autonomous mode, choose who controls position sizing and exposure. QDE Risk
                  Management adapts dynamically to confidence, volatility, and account health.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Manual Risk */}
                  <button
                    onClick={() => handleRiskToggle("manual")}
                    disabled={pendingRisk !== null}
                    className={`relative rounded-lg border-2 p-4 text-left transition-colors ${
                      currentRisk === "manual"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/50"
                    }`}
                  >
                    {currentRisk === "manual" && (
                      <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-primary" />
                    )}
                    <p className="font-medium text-sm mb-1">Manual Risk</p>
                    <p className="text-xs text-muted-foreground">
                      You specify lot size, stop loss, and take profit. The QDE respects your
                      parameters.
                    </p>
                  </button>

                  {/* QDE Risk */}
                  <button
                    onClick={() => handleRiskToggle("qde")}
                    disabled={pendingRisk !== null}
                    className={`relative rounded-lg border-2 p-4 text-left transition-colors ${
                      currentRisk === "qde"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/50"
                    }`}
                  >
                    {currentRisk === "qde" && (
                      <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-primary" />
                    )}
                    <p className="font-medium text-sm mb-1">QDE Risk Management</p>
                    <p className="text-xs text-muted-foreground">
                      The QDE controls sizing, exposure, and drawdown protection. Adapts to
                      confidence and market quality in real time.
                    </p>
                  </button>
                </div>

                {currentRisk === "manual" && (
                  <div className="mt-4 rounded-lg border border-border p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                      Manual Risk Parameters
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="risk-lot-size" className="text-xs">Lot size</Label>
                        <Input
                          id="risk-lot-size"
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="e.g. 0.10"
                          value={riskForm.lotSize ?? ""}
                          onChange={(e) => updateRiskField("lotSize", e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="risk-max-daily-loss" className="text-xs">Max daily loss (%)</Label>
                        <Input
                          id="risk-max-daily-loss"
                          type="number"
                          min={0}
                          step="0.1"
                          placeholder="e.g. 2"
                          value={riskForm.maxDailyLossPct ?? ""}
                          onChange={(e) => updateRiskField("maxDailyLossPct", e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="risk-stop-loss" className="text-xs">Stop loss (pips)</Label>
                        <Input
                          id="risk-stop-loss"
                          type="number"
                          min={0}
                          step="1"
                          placeholder="e.g. 20"
                          value={riskForm.stopLossPips ?? ""}
                          onChange={(e) => updateRiskField("stopLossPips", e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="risk-take-profit" className="text-xs">Take profit (pips)</Label>
                        <Input
                          id="risk-take-profit"
                          type="number"
                          min={0}
                          step="1"
                          placeholder="e.g. 40"
                          value={riskForm.takeProfitPips ?? ""}
                          onChange={(e) => updateRiskField("takeProfitPips", e.target.value)}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      These values are passed to the QDE so it respects your sizing and exit rules instead of computing its own.
                    </p>
                    <Button
                      size="sm"
                      className="mt-3"
                      onClick={handleSaveRiskParams}
                      disabled={savingRiskParams || !riskFormDirty}
                    >
                      {savingRiskParams ? "Saving…" : "Save Risk Parameters"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Symbol Selection Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart2 className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Monitored Symbols</CardTitle>
                {entitlement?.maxSymbols != null && (
                  <Badge variant="secondary" className="ml-auto">
                    {userSymbols.length} / {entitlement.maxSymbols}
                  </Badge>
                )}
              </div>
              <CardDescription>
                Select the instruments you want the QDE to monitor. The QDE will only analyse and
                trade symbols you have explicitly enabled.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {symbolsLoading ? (
                <div className="text-sm text-muted-foreground">Loading symbols…</div>
              ) : sortedAvailableGroups.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No symbols are available. Ask an admin to configure the symbol registry.
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {sortedAvailableGroups.map(([slug, group]) => (
                    <div key={slug}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                        {group.categoryName}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {group.symbols.map((s) => {
                          const selected = userSymbolIds.has(s.id);
                          return (
                            <button
                              key={s.id}
                              onClick={() => handleSymbolToggle(s.id, selected)}
                              disabled={addSymbol.isPending || removeSymbol.isPending}
                              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                                selected
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                              }`}
                            >
                              {selected && <CheckCircle2 className="h-3 w-3" />}
                              {s.canonicalSymbol}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Current selection summary */}
              {(userSymbols as UserSymbol[]).length > 0 && (
                <>
                  <Separator className="my-4" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Currently monitored ({(userSymbols as UserSymbol[]).length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {symbolGroups.map((group) =>
                        group.symbols.map((s) => (
                          <Badge key={s.id} variant="secondary" className="text-xs">
                            {s.canonicalSymbol}
                          </Badge>
                        )),
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
