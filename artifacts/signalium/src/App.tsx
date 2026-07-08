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
import Settings from "@/pages/settings";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminUsers from "@/pages/admin/users";
import AdminSubscriptions from "@/pages/admin/subscriptions";
import AdminEas from "@/pages/admin/eas";
import AdminPayments from "@/pages/admin/payments";
import AdminSmtp from "@/pages/admin/smtp";
import AdminApiKeys from "@/pages/admin/api-keys";
import Payments from "@/pages/payments";
import ApiKeys from "@/pages/api-keys";

import { AppLayout } from "@/components/layout";

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

function ProtectedRoute({ component: Component }: { component: React.ComponentType<any> }) {
  return (
    <>
      <Show when="signed-in">
        <AppLayout>
          <Component />
        </AppLayout>
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
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            
            <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
            <Route path="/ea"><ProtectedRoute component={EaList} /></Route>
            <Route path="/ea/:id"><ProtectedRoute component={EaDetail} /></Route>
            <Route path="/runtime"><ProtectedRoute component={Runtime} /></Route>
            <Route path="/subscriptions"><ProtectedRoute component={Subscriptions} /></Route>
            <Route path="/payments"><ProtectedRoute component={Payments} /></Route>
            <Route path="/api-keys"><ProtectedRoute component={ApiKeys} /></Route>
            <Route path="/settings"><ProtectedRoute component={Settings} /></Route>

            <Route path="/admin"><ProtectedRoute component={AdminDashboard} /></Route>
            <Route path="/admin/users"><ProtectedRoute component={AdminUsers} /></Route>
            <Route path="/admin/subscriptions"><ProtectedRoute component={AdminSubscriptions} /></Route>
            <Route path="/admin/eas"><ProtectedRoute component={AdminEas} /></Route>
            <Route path="/admin/payments"><ProtectedRoute component={AdminPayments} /></Route>
            <Route path="/admin/smtp"><ProtectedRoute component={AdminSmtp} /></Route>
            <Route path="/admin/api-keys"><ProtectedRoute component={AdminApiKeys} /></Route>

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