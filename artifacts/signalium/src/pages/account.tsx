import { useUser, UserProfile } from "@clerk/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SecurityTab } from "@/components/account/security-tab";
import { ReferralsTab } from "@/components/account/referrals-tab";
import Subscriptions from "@/pages/subscriptions";
import Payments from "@/pages/payments";
import ApiKeys from "@/pages/api-keys";
import EaBuilds from "@/pages/ea-builds";
import { useFeatureFlag } from "@/hooks/use-feature-flags";

export default function Account() {
  const { user } = useUser();
  const referralsEnabled = useFeatureFlag("referrals_enabled");

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="px-4 sm:px-8 py-6 border-b border-border">
        <h1 className="text-2xl font-bold tracking-tight">Account & Security</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your profile, billing, API keys, MT5/EA connections, and account security
        </p>
      </div>

      <div className="p-4 sm:p-8">
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="flex w-full sm:w-fit flex-wrap h-auto sm:h-9 gap-1">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="api-keys">API Keys &amp; MT5</TabsTrigger>
            <TabsTrigger value="ea-builds">EA Builds</TabsTrigger>
            {referralsEnabled && <TabsTrigger value="referrals">Referrals</TabsTrigger>}
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-6 max-w-3xl">
            <UserProfile
              appearance={{
                elements: {
                  rootBox: "w-full",
                  card: "bg-card border border-border shadow-none rounded-lg",
                  navbar: "bg-secondary border-r border-border",
                  navbarButton: "text-muted-foreground hover:text-foreground hover:bg-secondary",
                  navbarButtonActive: "text-foreground bg-secondary",
                  pageScrollBox: "bg-card",
                  formFieldInput: "bg-input border-border text-foreground rounded-lg",
                  formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg",
                  badge: "bg-primary/10 text-primary",
                },
              }}
            />
          </TabsContent>

          <TabsContent value="billing" className="mt-6">
            <div className="flex flex-col gap-10 max-w-5xl">
              <Subscriptions embedded />
              <div className="border-t border-border pt-8">
                <Payments embedded />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="api-keys" className="mt-6">
            <ApiKeys embedded />
          </TabsContent>

          <TabsContent value="ea-builds" className="mt-6">
            <EaBuilds embedded />
          </TabsContent>

          {referralsEnabled && (
            <TabsContent value="referrals" className="mt-6">
              <ReferralsTab />
            </TabsContent>
          )}

          <TabsContent value="security" className="mt-6 max-w-4xl">
            <SecurityTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
