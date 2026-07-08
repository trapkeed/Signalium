import { useGetStatsOverview } from "@workspace/api-client-react";
import { Users, Activity, CreditCard, Cpu, TrendingUp, BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

export default function AdminDashboard() {
  const { data: stats, isLoading } = useGetStatsOverview();

  const tierData = stats?.subscriptionsByTier
    ? Object.entries(stats.subscriptionsByTier).map(([tier, count]) => ({
        tier: tier.charAt(0).toUpperCase() + tier.slice(1),
        count: count as number,
      }))
    : [];

  const TIER_COLORS = { Starter: "#22d3a5", Professional: "#00d4ff", Enterprise: "#f59e0b" };

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-border">
        <h1 className="text-xl font-bold tracking-tight">Admin Overview</h1>
        <p className="text-xs text-muted-foreground mt-0.5 font-mono">Platform statistics</p>
      </div>

      <div className="p-8 space-y-8">
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="border border-border bg-card rounded-sm p-5 animate-pulse">
                <div className="h-3 bg-secondary rounded w-2/3 mb-3" />
                <div className="h-7 bg-secondary rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : stats ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="border border-border bg-card rounded-sm p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-primary" />
                  <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Total Users</div>
                </div>
                <div className="text-3xl font-bold font-mono">{stats.totalUsers}</div>
                <div className="text-xs text-success mt-1 font-mono">+{stats.recentSignups} last 30d</div>
              </div>

              <div className="border border-border bg-card rounded-sm p-5">
                <div className="flex items-center gap-2 mb-3">
                  <CreditCard className="w-4 h-4 text-success" />
                  <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Active Subs</div>
                </div>
                <div className="text-3xl font-bold font-mono">{stats.activeSubscriptions}</div>
              </div>

              <div className="border border-border bg-card rounded-sm p-5">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-warning" />
                  <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">MRR</div>
                </div>
                <div className="text-3xl font-bold font-mono">${stats.revenueMonthly.toFixed(0)}</div>
              </div>

              <div className="border border-border bg-card rounded-sm p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Cpu className="w-4 h-4 text-muted-foreground" />
                  <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Total EAs</div>
                </div>
                <div className="text-3xl font-bold font-mono">{stats.totalEas}</div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="border border-border bg-card rounded-sm p-6">
                <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-4">Subscriptions by Tier</div>
                {tierData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={tierData} barCategoryGap="30%">
                      <XAxis dataKey="tier" tick={{ fontSize: 11, fontFamily: "monospace", fill: "hsl(220 20% 60%)" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fontFamily: "monospace", fill: "hsl(220 20% 60%)" }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: "hsl(220 20% 6%)", border: "1px solid hsl(220 20% 12%)", borderRadius: "2px", fontSize: 12, fontFamily: "monospace" }}
                        itemStyle={{ color: "hsl(190 20% 90%)" }}
                        cursor={{ fill: "hsl(220 20% 12%)" }}
                      />
                      <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                        {tierData.map((entry) => (
                          <Cell key={entry.tier} fill={TIER_COLORS[entry.tier as keyof typeof TIER_COLORS] ?? "#00d4ff"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">No subscription data</div>
                )}
              </div>

              <div className="border border-border bg-card rounded-sm p-6">
                <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-4">Platform Activity</div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground font-mono">Total telemetry events</span>
                    <span className="font-mono font-bold">{stats.totalTelemetryEvents}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground font-mono">Active subscriptions</span>
                    <span className="font-mono font-bold">{stats.activeSubscriptions}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground font-mono">Total users</span>
                    <span className="font-mono font-bold">{stats.totalUsers}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground font-mono">Monthly revenue</span>
                    <span className="font-mono font-bold text-success">${stats.revenueMonthly.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground font-mono">New signups (30d)</span>
                    <span className="font-mono font-bold text-primary">{stats.recentSignups}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
