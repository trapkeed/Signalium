import { useEffect } from "react";
import { useLocation } from "wouter";
import { useListActiveSeoRedirects } from "@workspace/api-client-react";

/**
 * Applies admin-configured SEO redirects (seo_redirects table) on the
 * client. Signalium's production hosting serves the SPA as static files
 * with a catch-all rewrite to index.html (no per-request server logic
 * sits in front of the site), so there is no place to perform this as a
 * real HTTP 301/302 for direct hits — this is a documented limitation of
 * that hosting model, not an oversight. Search engines that execute JS
 * will still see the resulting `window.location.replace`, and app-internal
 * links always go through this same client-side router.
 *
 * `redirect.statusCode` is preserved on the model for a future
 * server-side implementation (e.g. if this app ever moves to an
 * SSR/edge-function fronted deployment) but doesn't change client
 * navigation behavior today.
 */
export function useSeoRedirects() {
  const [rawPath, setLocation] = useLocation();
  const path = rawPath || "/";

  const { data: redirects } = useListActiveSeoRedirects({
    query: { queryKey: ["seo-redirects-active"], staleTime: 60_000 },
  });

  useEffect(() => {
    if (!redirects) return;
    const match = redirects.find((r) => r.fromPath === path);
    if (match && match.toPath !== path) {
      setLocation(match.toPath, { replace: true });
    }
  }, [redirects, path, setLocation]);
}
