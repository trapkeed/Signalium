import { useMemo } from "react";
import { useGetSiteContent } from "@workspace/api-client-react";
import { DEFAULT_SITE_CONTENT, mergeSiteContent, type SiteContentData } from "@/lib/site-content";

/**
 * Resolves the current homepage content: the admin-edited override merged
 * over the built-in defaults, or the defaults outright if nothing has been
 * customized yet (or the request hasn't resolved/failed). Never throws or
 * blanks the page — a broken/slow site-content fetch just means visitors
 * see the default copy.
 */
export function useSiteContent(): SiteContentData {
  const { data } = useGetSiteContent();

  return useMemo(() => {
    if (!data?.content) return DEFAULT_SITE_CONTENT;
    try {
      return mergeSiteContent(JSON.parse(data.content));
    } catch {
      return DEFAULT_SITE_CONTENT;
    }
  }, [data]);
}
