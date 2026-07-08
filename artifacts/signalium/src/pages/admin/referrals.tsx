import { useState } from "react";
import { useListAllReferrals, useGetReferralLeaderboard } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Gift, Trophy } from "lucide-react";

function userLabel(email?: string | null, firstName?: string | null, lastName?: string | null) {
  const name = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  return name || email || "Unknown user";
}

export default function AdminReferrals() {
  const [search, setSearch] = useState("");
  const { data: activity = [] } = useListAllReferrals();
  const { data: leaderboard = [] } = useGetReferralLeaderboard();

  const q = search.trim().toLowerCase();
  const filteredActivity = q
    ? activity.filter((r) =>
        [r.referralCode, r.referrerEmail, r.referrerFirstName, r.referrerLastName, r.referredEmail, r.referredFirstName, r.referredLastName]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(q)),
      )
    : activity;

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Gift className="w-5 h-5 text-primary" /> Referrals
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Platform-wide referral activity and top referrers.</p>
      </div>

      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="mt-4 flex flex-col gap-4">
          <Input
            placeholder="Search by name, email, or referral code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />

          {filteredActivity.length === 0 ? (
            <div className="border border-border rounded-lg p-12 text-center text-sm text-muted-foreground">
              No referral activity yet.
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold">Referrer</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Referred user</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Code</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActivity.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{userLabel(r.referrerEmail, r.referrerFirstName, r.referrerLastName)}</div>
                        <div className="text-xs text-muted-foreground">{r.referrerEmail}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{userLabel(r.referredEmail, r.referredFirstName, r.referredLastName)}</div>
                        <div className="text-xs text-muted-foreground">{r.referredEmail}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="font-mono">{r.referralCode}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="leaderboard" className="mt-4">
          {leaderboard.length === 0 ? (
            <div className="border border-border rounded-lg p-12 text-center text-sm text-muted-foreground">
              No referrals yet.
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold w-12">#</th>
                    <th className="text-left px-4 py-2.5 font-semibold">User</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Referrals</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, i) => (
                    <tr key={entry.userId} className="border-t border-border">
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {i === 0 ? <Trophy className="w-4 h-4 text-primary" /> : i + 1}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{userLabel(entry.email, entry.firstName, entry.lastName)}</div>
                        <div className="text-xs text-muted-foreground">{entry.email}</div>
                      </td>
                      <td className="px-4 py-2.5 font-mono">{entry.referralCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
