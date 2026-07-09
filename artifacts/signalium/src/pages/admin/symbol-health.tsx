import { useMemo, useState } from "react";
import { useGetOperationalSymbolHealth } from "@workspace/api-client-react";
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

type SortKey = "canonicalSymbol" | "qualityScore" | "feedLatencyMs" | "lastDataAt";

const SYNC_STYLES: Record<string, string> = {
  synced: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  degraded: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  unsynced: "bg-red-500/10 text-red-400 border-red-500/20",
};

const NORM_STYLES: Record<string, string> = {
  resolved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  partial: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  unresolved: "bg-red-500/10 text-red-400 border-red-500/20",
  no_data: "bg-muted text-muted-foreground",
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
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Radio className="w-6 h-6 text-yellow-400" />
            Symbol Health
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Per-symbol sync status, normalization coverage, broker mappings, and feed quality — computed live from
            data-provider status (no dedicated candle feed is ingested yet, so timing signals are approximated from
            the most recent successful provider sync).
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Input
          placeholder="Search symbol…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={syncFilter} onValueChange={setSyncFilter}>
          <SelectTrigger className="w-44">
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

      {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}

      {!isLoading && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button className="flex items-center gap-1" onClick={() => toggleSort("canonicalSymbol")}>
                      Symbol <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead>Sync Status</TableHead>
                  <TableHead>Normalization</TableHead>
                  <TableHead>Broker Mapping</TableHead>
                  <TableHead>
                    <button className="flex items-center gap-1" onClick={() => toggleSort("lastDataAt")}>
                      Last Data <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button className="flex items-center gap-1" onClick={() => toggleSort("feedLatencyMs")}>
                      Feed Latency <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button className="flex items-center gap-1" onClick={() => toggleSort("qualityScore")}>
                      Quality <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No symbols match the current filters.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((r) => (
                  <TableRow key={r.symbolId as number}>
                    <TableCell>
                      <div className="font-medium">{r.canonicalSymbol as string}</div>
                      <div className="text-xs text-muted-foreground">{r.displayName as string}</div>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${SYNC_STYLES[r.syncStatus as string] ?? ""} border text-xs`}>
                        {r.syncStatus as string}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${NORM_STYLES[r.normalizationStatus as string] ?? ""} border text-xs`}>
                        {(r.normalizationStatus as string).replace(/_/g, " ")}
                      </Badge>
                      {r.normalizationResolvedRate != null && (
                        <span className="text-xs text-muted-foreground ml-1.5">
                          {((r.normalizationResolvedRate as number) * 100).toFixed(0)}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.brokerMappingCoverage as number}/{r.totalActiveBrokers as number} brokers
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{timeAgo(r.lastDataAt as string | null)}</TableCell>
                    <TableCell className="text-sm">
                      {r.feedLatencyMs != null ? `${Math.round(r.feedLatencyMs as number)}ms` : "—"}
                    </TableCell>
                    <TableCell>
                      <span className={`font-semibold ${qualityColor(r.qualityScore as number)}`}>
                        {r.qualityScore as number}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
