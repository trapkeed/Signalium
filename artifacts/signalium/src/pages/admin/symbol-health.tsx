import { useMemo, useState } from "react";
import { useGetOperationalSymbolHealth, getGetOperationalSymbolHealthQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Radio, ArrowUpDown, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { OpsShell } from "@/components/ops/ops-shell";
import { useOpsRealtimeTypes } from "@/hooks/use-ops-realtime";
import { useQueryClient } from "@tanstack/react-query";

type SortKey = "canonicalSymbol" | "qualityScore" | "feedLatencyMs" | "lastDataAt";

const SYNC_STYLES: Record<string, string> = {
  synced: "bg-emerald-950/30 text-emerald-400 border-emerald-900/50",
  degraded: "bg-yellow-950/30 text-yellow-400 border-yellow-900/50",
  unsynced: "bg-red-950/30 text-red-400 border-red-900/50",
};

const NORM_STYLES: Record<string, string> = {
  resolved: "bg-emerald-950/30 text-emerald-400 border-emerald-900/50",
  partial: "bg-yellow-950/30 text-yellow-400 border-yellow-900/50",
  unresolved: "bg-red-950/30 text-red-400 border-red-900/50",
  no_data: "bg-background/50 text-cyan-500/50 border-cyan-900/30",
};

function qualityColor(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 50) return "text-yellow-400";
  return "text-red-400";
}

function timeAgo(v: string | null) {
  if (!v) return "Never";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

export default function AdminSymbolHealth() {
  const queryClient = useQueryClient();
  useOpsRealtimeTypes(["health.snapshot"], () => {
    void queryClient.invalidateQueries({ queryKey: getGetOperationalSymbolHealthQueryKey() });
  });

  const { data, isLoading, refetch, isFetching } = useGetOperationalSymbolHealth();
  const [search, setSearch] = useState("");
  const [syncFilter, setSyncFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("qualityScore");
  const [sortAsc, setSortAsc] = useState(false);

  const rows = useMemo(() => {
    const d = data as Record<string, unknown> | undefined;
    return (d?.symbols as Array<Record<string, unknown>>) ?? [];
  }, [data]);

  const filtered = useMemo(() => {
    let list = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          (r.canonicalSymbol as string).toLowerCase().includes(q) ||
          (r.displayName as string).toLowerCase().includes(q),
      );
    }
    if (syncFilter !== "all") {
      list = list.filter((r) => r.syncStatus === syncFilter);
    }
    const sorted = [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv);
      return (av as number) - (bv as number);
    });
    return sortAsc ? sorted : sorted.reverse();
  }, [rows, search, syncFilter, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  return (
    <OpsShell
      title="Symbol Health"
      description="Per-symbol sync status, normalization coverage, broker mappings, and feed quality."
      actions={
        <Button size="sm" variant="outline" className="border-cyan-900/50 text-cyan-50 hover:bg-cyan-900/20 bg-background/50" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      }
    >
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Input
          placeholder="Search symbol…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:max-w-xs bg-background/50 border-cyan-900/30 text-cyan-50 placeholder:text-cyan-500/50 font-mono text-xs"
        />
        <Select value={syncFilter} onValueChange={setSyncFilter}>
          <SelectTrigger className="w-full sm:w-44 bg-background/50 border-cyan-900/30 text-cyan-50 font-mono text-xs">
            <SelectValue placeholder="Sync status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sync statuses</SelectItem>
            <SelectItem value="synced">Synced</SelectItem>
            <SelectItem value="degraded">Degraded</SelectItem>
            <SelectItem value="unsynced">Unsynced</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING HEALTH DATA... ]</div>}

      {!isLoading && (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="w-full text-xs font-mono">
                <TableHeader>
                  <TableRow className="border-b border-cyan-900/30 bg-background/50 hover:bg-background/50">
                    <TableHead className="text-cyan-100/50 font-semibold tracking-wider">
                      <button className="flex items-center gap-1.5 uppercase hover:text-cyan-100" onClick={() => toggleSort("canonicalSymbol")}>
                        Symbol <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </TableHead>
                    <TableHead className="text-cyan-100/50 font-semibold tracking-wider uppercase">Sync Status</TableHead>
                    <TableHead className="text-cyan-100/50 font-semibold tracking-wider uppercase">Normalization</TableHead>
                    <TableHead className="text-cyan-100/50 font-semibold tracking-wider uppercase">Broker Mapping</TableHead>
                    <TableHead className="text-cyan-100/50 font-semibold tracking-wider">
                      <button className="flex items-center gap-1.5 uppercase hover:text-cyan-100" onClick={() => toggleSort("lastDataAt")}>
                        Last Data <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </TableHead>
                    <TableHead className="text-cyan-100/50 font-semibold tracking-wider">
                      <button className="flex items-center gap-1.5 uppercase hover:text-cyan-100" onClick={() => toggleSort("feedLatencyMs")}>
                        Feed Latency <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </TableHead>
                    <TableHead className="text-cyan-100/50 font-semibold tracking-wider">
                      <button className="flex items-center gap-1.5 uppercase hover:text-cyan-100" onClick={() => toggleSort("qualityScore")}>
                        Quality <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-[11px]">
                  {filtered.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="text-center text-cyan-500/50 py-8 font-mono uppercase tracking-wider">
                        [ No symbols match the current filters ]
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((r) => (
                    <TableRow key={r.symbolId as number} className="border-b border-cyan-900/10 hover:bg-cyan-950/20 transition-colors">
                      <TableCell>
                        <div className="font-bold text-cyan-50">{r.canonicalSymbol as string}</div>
                        <div className="text-[10px] text-cyan-500/70 truncate max-w-[120px]" title={r.displayName as string}>{r.displayName as string}</div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${SYNC_STYLES[r.syncStatus as string] ?? ""} border text-[10px] font-mono uppercase tracking-wider`}>
                          {r.syncStatus as string}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge className={`${NORM_STYLES[r.normalizationStatus as string] ?? ""} border text-[10px] font-mono uppercase tracking-wider`}>
                            {(r.normalizationStatus as string).replace(/_/g, " ")}
                          </Badge>
                          {r.normalizationResolvedRate != null && (
                            <span className="text-[10px] text-cyan-500/70">
                              {((r.normalizationResolvedRate as number) * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-cyan-100">
                        {r.brokerMappingCoverage as number} <span className="opacity-50">/</span> {r.totalActiveBrokers as number}
                      </TableCell>
                      <TableCell className="text-cyan-500/70">{timeAgo(r.lastDataAt as string | null)}</TableCell>
                      <TableCell className="text-cyan-100">
                        {r.feedLatencyMs != null ? `${Math.round(r.feedLatencyMs as number)}ms` : "—"}
                      </TableCell>
                      <TableCell>
                        <span className={`font-bold text-sm ${qualityColor(r.qualityScore as number)}`}>
                          {r.qualityScore as number}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </OpsShell>
  );
}
