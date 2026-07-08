import { useEffect } from "react";
import { useLocation } from "wouter";
import { useResolveSeoPage } from "@workspace/api-client-react";

function setMetaTag(attr: "name" | "property", key: string, content: string | null | undefined) {
  const selector = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);

  if (!content) {
    el?.remove();
    return;
  }

  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLinkTag(rel: string, href: string | null | undefined, extraAttrs?: Record<string, string>) {
  const selector = extraAttrs?.hreflang
    ? `link[rel="${rel}"][hreflang="${extraAttrs.hreflang}"]`
    : `link[rel="${rel}"]:not([hreflang])`;
  let el = document.head.querySelector<HTMLLinkElement>(selector);

  if (!href) {
    el?.remove();
    return;
  }

  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    if (extraAttrs) {
      for (const [k, v] of Object.entries(extraAttrs)) el.setAttribute(k, v);
    }
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function clearHreflangLinks() {
  document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el) => el.remove());
}

function clearStructuredData() {
  document.head.querySelectorAll('script[data-seo-structured-data="true"]').forEach((el) => el.remove());
}

/**
 * Applies dynamic SEO head tags (title, meta description, canonical, OG,
 * Twitter, hreflang, structured data, robots) for the current route. This is
 * a client-side-only SPA solution — there is no SSR, so tags update after
 * mount/route change rather than being present in the initial HTML response.
 */
export function useSeoHead() {
  const [rawPath] = useLocation();
  const path = rawPath || "/";

  const { data: page } = useResolveSeoPage(
    { path },
    { query: { queryKey: ["seo-resolve", path] } },
  );

  useEffect(() => {
    if (!page) return;

    if (page.title) document.title = page.title;
    setMetaTag("name", "description", page.description);

    const robotsParts: string[] = [];
    if (page.noIndex) robotsParts.push("noindex");
    if (page.noFollow) robotsParts.push("nofollow");
    setMetaTag("name", "robots", robotsParts.length > 0 ? robotsParts.join(", ") : "index, follow");

    setLinkTag("canonical", page.canonicalUrl);

    setMetaTag("property", "og:title", page.ogTitle ?? page.title);
    setMetaTag("property", "og:description", page.ogDescription ?? page.description);
    setMetaTag("property", "og:image", page.ogImage);

    setMetaTag("name", "twitter:card", page.twitterCard);
    setMetaTag("name", "twitter:title", page.twitterTitle ?? page.ogTitle ?? page.title);
    setMetaTag(
      "name",
      "twitter:description",
      page.twitterDescription ?? page.ogDescription ?? page.description,
    );
    setMetaTag("name", "twitter:image", page.twitterImage ?? page.ogImage);

    clearHreflangLinks();
    for (const entry of page.hreflang ?? []) {
      setLinkTag("alternate", entry.url, { hreflang: entry.lang });
    }

    clearStructuredData();
    if (page.structuredData) {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.dataset.seoStructuredData = "true";
      script.textContent = page.structuredData;
      document.head.appendChild(script);
    }
  }, [page]);
}
