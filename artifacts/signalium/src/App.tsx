import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { dark } from "@clerk/themes";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import EaList from "@/pages/ea/list";
import EaDetail from "@/pages/ea/detail";
import Runtime from "@/pages/runtime";
import Subscriptions from "@/pages/subscriptions";
import Account from "@/pages/account";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminUsers from "@/pages/admin/users";
import AdminSubscriptions from "@/pages/admin/subscriptions";
import AdminPlans from "@/pages/admin/plans";
import AdminEas from "@/pages/admin/eas";
import AdminPayments from "@/pages/admin/payments";
import AdminSmtp from "@/pages/admin/smtp";
import AdminApiKeys from "@/pages/admin/api-keys";
import Payments from "@/pages/payments";
import ApiKeys from "@/pages/api-keys";
import EaBuilds from "@/pages/ea-builds";
import AdminEaBuilds from "@/pages/admin/ea-builds";
import AdminSymbols from "@/pages/admin/symbols";
import AdminQde from "@/pages/admin/qde";
import AdminSeo from "@/pages/admin/seo";
import AdminMedia from "@/pages/admin/media";
import AdminAnnouncements from "@/pages/admin/announcements";
import AdminMaintenanceBanner from "@/pages/admin/maintenance-banner";
import Contact from "@/pages/contact";
import KnowledgeBase from "@/pages/knowledge-base";
import KbArticle from "@/pages/kb-article";
import StatusPage from "@/pages/status-page";
import Support from "@/pages/support";
import SupportTicketDetail from "@/pages/support-ticket-detail";
import AdminSupport from "@/pages/admin/support";
import AdminContact from "@/pages/admin/contact";
import AdminKnowledgeBase from "@/pages/admin/knowledge-base";
import AdminStatusPage from "@/pages/admin/status";
import AdminBrokers from "@/pages/admin/brokers";
import AdminDataProviders from "@/pages/admin/data-providers";
import AdminInferenceGateway from "@/pages/admin/inference-gateway";
import AdminTradeIntelligence from "@/pages/admin/trade-intelligence";
import AdminDeployments from "@/pages/admin/deployments";
import AdminOperations from "@/pages/admin/operations";
import AdminOpsDashboard from "@/pages/admin/ops-dashboard";
import AdminResilienceDashboard from "@/pages/admin/resilience-dashboard";
import AdminGovernance from "@/pages/admin/governance";
import AdminPlatformHealth from "@/pages/admin/platform-health";
import AdminEaMonitor from "@/pages/admin/ea-monitor";
import AdminIncidents from "@/pages/admin/incidents";
import AdminAlerts from "@/pages/admin/alerts";
import AdminSymbolHealth from "@/pages/admin/symbol-health";
import AdminFeatureFlags from "@/pages/admin/feature-flags";

import { AppLayout } from "@/components/layout";
import { AccountGate } from "@/components/account-gate";
import { useSeoHead } from "@/hooks/use-seo-head";
import { useSeoRedirects } from "@/hooks/use-seo-redirects";
import { REFERRAL_CODE_STORAGE_KEY } from "@/lib/referral";
import AdminReferrals from "@/pages/admin/referrals";
import AdminAuditLog from "@/pages/admin/audit-log";
import AdminSecurityOperations from "@/pages/admin/security-operations";
import AdminResearchLabExperiments from "@/pages/admin/research-lab/experiments";
import AdminResearchLabTraining from "@/pages/admin/research-lab/training";
import AdminResearchLabValidation from "@/pages/admin/research-lab/validation";
import AdminResearchLabShadowTesting from "@/pages/admin/research-lab/shadow-testing";
import AdminResearchLabDeployment from "@/pages/admin/research-lab/deployment";
import AdminResearchLabResearchIntelligence from "@/pages/admin/research-lab/research-intelligence";
import AdminResearchLabGenealogy from "@/pages/admin/research-lab/genealogy";

import { OpsConnectionProvider } from "@/hooks/use-ops-realtime";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

const isProduction = import.meta.env.PROD;
const clerkProxyUrl = isProduction
  ? (import.meta.env.VITE_CLERK_PROXY_URL ?? `${window.location.origin}/api/__clerk`)
  : undefined;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: dark,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
  },
  variables: {
    colorPrimary: "hsl(191, 100%, 50%)", // cyan-ish
    colorBackground: "hsl(220, 20%, 6%)",
    colorInput: "hsl(220, 20%, 15%)",
    colorNeutral: "hsl(220, 20%, 12%)",
    fontFamily: "'Inter', system-ui, sans-serif",
    borderRadius: "0.25rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#0c1015] border border-[#18212a] rounded-md w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground",
    formFieldLabel: "text-foreground",
    footerActionLink: "text-primary hover:text-primary/90",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    identityPreviewEditButton: "text-primary hover:text-primary/90",
    formFieldSuccessText: "text-success",
    alertText: "text-destructive",
    formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90",
    formFieldInput: "bg-input border-border text-foreground rounded-sm",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component, ops }: { component: React.ComponentType<any>; ops?: boolean }) {
  // `ops` scopes the admin-ops WebSocket connection to only the 9 ops pages
  // that need it — mounting it app-wide would make every signed-in session
  // (including non-staff users) open and endlessly retry a connection the
  // gateway will always reject with 401.
  const content = ops ? (
    <OpsConnectionProvider>
      <Component />
    </OpsConnectionProvider>
  ) : (
    <Component />
  );
  return (
    <>
      <Show when="signed-in">
        <AccountGate>
          <AppLayout>
            {content}
          </AppLayout>
        </AccountGate>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function SeoHeadManager() {
  useSeoHead();
  useSeoRedirects();
  return null;
}

/** Captures ?ref=CODE from the URL (e.g. a referral link) into localStorage
 * so it survives the sign-up flow and can be attributed on first login. */
function ReferralCaptureManager() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && ref.trim()) {
      localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, ref.trim());
    }
  }, []);
  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <SeoHeadManager />
        <ReferralCaptureManager />
        <TooltipProvider>
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route path="/contact" component={Contact} />
              <Route path="/kb" component={KnowledgeBase} />
              <Route path="/kb/:slug" component={KbArticle} />
              <Route path="/status" component={StatusPage} />

              <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
              <Route path="/ea"><ProtectedRoute component={EaList} /></Route>
              <Route path="/ea/:id"><ProtectedRoute component={EaDetail} /></Route>
              <Route path="/runtime"><ProtectedRoute component={Runtime} /></Route>
              <Route path="/subscriptions"><ProtectedRoute component={Subscriptions} /></Route>
              <Route path="/payments"><ProtectedRoute component={Payments} /></Route>
              <Route path="/api-keys"><ProtectedRoute component={ApiKeys} /></Route>
              <Route path="/ea-builds"><ProtectedRoute component={EaBuilds} /></Route>
              <Route path="/support"><ProtectedRoute component={Support} /></Route>
              <Route path="/support/:id"><ProtectedRoute component={SupportTicketDetail} /></Route>
              <Route path="/account"><ProtectedRoute component={Account} /></Route>
              <Route path="/settings"><Redirect to="/account" /></Route>

              <Route path="/admin"><ProtectedRoute component={AdminDashboard} /></Route>
              <Route path="/admin/users"><ProtectedRoute component={AdminUsers} /></Route>
              <Route path="/admin/plans"><ProtectedRoute component={AdminPlans} /></Route>
              <Route path="/admin/subscriptions"><ProtectedRoute component={AdminSubscriptions} /></Route>
              <Route path="/admin/eas"><ProtectedRoute component={AdminEas} /></Route>
              <Route path="/admin/payments"><ProtectedRoute component={AdminPayments} /></Route>
              <Route path="/admin/smtp"><ProtectedRoute component={AdminSmtp} /></Route>
              <Route path="/admin/api-keys"><ProtectedRoute component={AdminApiKeys} /></Route>
              <Route path="/admin/ea-builds"><ProtectedRoute component={AdminEaBuilds} /></Route>
              <Route path="/admin/symbols"><ProtectedRoute component={AdminSymbols} /></Route>
              <Route path="/admin/brokers"><ProtectedRoute component={AdminBrokers} /></Route>
              <Route path="/admin/data-providers"><ProtectedRoute component={AdminDataProviders} /></Route>
              <Route path="/admin/inference-gateway"><ProtectedRoute component={AdminInferenceGateway} /></Route>
              <Route path="/admin/trade-intelligence"><ProtectedRoute component={AdminTradeIntelligence} /></Route>
              <Route path="/admin/deployments"><ProtectedRoute component={AdminDeployments} ops /></Route>
              <Route path="/admin/operations"><ProtectedRoute component={AdminOperations} ops /></Route>
              <Route path="/admin/ops-dashboard"><ProtectedRoute component={AdminOpsDashboard} ops /></Route>
              <Route path="/admin/resilience"><ProtectedRoute component={AdminResilienceDashboard} ops /></Route>
              <Route path="/admin/governance"><ProtectedRoute component={AdminGovernance} ops /></Route>
              <Route path="/admin/platform-health"><ProtectedRoute component={AdminPlatformHealth} ops /></Route>
              <Route path="/admin/ea-monitor"><ProtectedRoute component={AdminEaMonitor} ops /></Route>
              <Route path="/admin/incidents"><ProtectedRoute component={AdminIncidents} ops /></Route>
              <Route path="/admin/alerts"><ProtectedRoute component={AdminAlerts} ops /></Route>
              <Route path="/admin/symbol-health"><ProtectedRoute component={AdminSymbolHealth} ops /></Route>
              <Route path="/admin/feature-flags"><ProtectedRoute component={AdminFeatureFlags} /></Route>
              <Route path="/admin/qde"><ProtectedRoute component={AdminQde} /></Route>
              <Route path="/admin/seo"><ProtectedRoute component={AdminSeo} /></Route>
              <Route path="/admin/media"><ProtectedRoute component={AdminMedia} /></Route>
              <Route path="/admin/announcements"><ProtectedRoute component={AdminAnnouncements} /></Route>
              <Route path="/admin/maintenance-banner"><ProtectedRoute component={AdminMaintenanceBanner} /></Route>
              <Route path="/admin/support"><ProtectedRoute component={AdminSupport} /></Route>
              <Route path="/admin/support/:id"><ProtectedRoute component={AdminSupport} /></Route>
              <Route path="/admin/contact"><ProtectedRoute component={AdminContact} /></Route>
              <Route path="/admin/knowledge-base"><ProtectedRoute component={AdminKnowledgeBase} /></Route>
              <Route path="/admin/status"><ProtectedRoute component={AdminStatusPage} /></Route>
              <Route path="/admin/referrals"><ProtectedRoute component={AdminReferrals} /></Route>
              <Route path="/admin/audit-log"><ProtectedRoute component={AdminAuditLog} ops /></Route>
              <Route path="/admin/security-operations"><ProtectedRoute component={AdminSecurityOperations} ops /></Route>
              <Route path="/admin/research-lab/experiments"><ProtectedRoute component={AdminResearchLabExperiments} /></Route>
              <Route path="/admin/research-lab/training"><ProtectedRoute component={AdminResearchLabTraining} /></Route>
              <Route path="/admin/research-lab/validation"><ProtectedRoute component={AdminResearchLabValidation} /></Route>
              <Route path="/admin/research-lab/shadow-testing"><ProtectedRoute component={AdminResearchLabShadowTesting} /></Route>
              <Route path="/admin/research-lab/deployment"><ProtectedRoute component={AdminResearchLabDeployment} /></Route>
              <Route path="/admin/research-lab/research-intelligence"><ProtectedRoute component={AdminResearchLabResearchIntelligence} /></Route>
              <Route path="/admin/research-lab/genealogy"><ProtectedRoute component={AdminResearchLabGenealogy} /></Route>

              <Route component={NotFound} />
            </Switch>
            <Toaster />
          </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;