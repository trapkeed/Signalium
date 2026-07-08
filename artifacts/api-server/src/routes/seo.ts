import { Router, type Request, type Response } from "express";
import { db, seoPagesTable, seoRedirectsTable, seoSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

const DEFAULT_ROBOTS_TXT = "User-agent: *\nAllow: /\n";

/**
 * The API transmits structuredData as a raw JSON string (to keep the OpenAPI
 * schema/zod codegen free of open-ended "object" schemas), while the DB
 * column stores it as parsed JSON. These helpers convert at the boundary.
 */
function toDbBody<T extends { structuredData?: unknown }>(body: T) {
  if (body.structuredData === undefined) return body;
  if (body.structuredData === null || body.structuredData === "") {
    return { ...body, structuredData: null };
  }
  if (typeof body.structuredData !== "string") return body;
  try {
    return { ...body, structuredData: JSON.parse(body.structuredData) };
  } catch {
    throw new Error("structuredData must be valid JSON");
  }
}

function toApiPage<T extends { structuredData?: unknown }>(page: T | undefined) {
  if (!page) return page;
  return {
    ...page,
    structuredData: page.structuredData ? JSON.stringify(page.structuredData) : null,
  };
}

async function getOrCreateSettings() {
  const [existing] = await db.select().from(seoSettingsTable).where(eq(seoSettingsTable.id, 1));
  if (existing) return existing;
  const [created] = await db
    .insert(seoSettingsTable)
    .values({ id: 1, robotsTxt: DEFAULT_ROBOTS_TXT, sitemapEnabled: true })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [refetched] = await db.select().from(seoSettingsTable).where(eq(seoSettingsTable.id, 1));
  return refetched;
}

// ---------------------------------------------------------------------------
// Pages (admin CRUD)
// ---------------------------------------------------------------------------

// GET /seo/pages — admin: list all page SEO configs
router.get("/pages", requireAdmin, async (req, res) => {
  try {
    const pages = await db.select().from(seoPagesTable).orderBy(seoPagesTable.path);
    return res.json(pages.map(toApiPage));
  } catch (err) {
    req.log.error(err, "Failed to list SEO pages");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /seo/pages/resolve?path=/foo — public: resolve SEO config for a route,
// used by the frontend to render dynamic head tags.
router.get("/pages/resolve", async (req, res) => {
  const path = String(req.query.path ?? "/");
  try {
    const [page] = await db.select().from(seoPagesTable).where(eq(seoPagesTable.path, path));
    return res.json(toApiPage(page) ?? null);
  } catch (err) {
    req.log.error(err, "Failed to resolve SEO page");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /seo/pages — admin: create page SEO config
router.post("/pages", requireAdmin, async (req, res) => {
  const { path } = req.body as { path?: string };
  if (!path) return res.status(400).json({ error: "path is required" });

  try {
    const [page] = await db.insert(seoPagesTable).values(toDbBody(req.body)).returning();
    return res.status(201).json(toApiPage(page));
  } catch (err) {
    if (err instanceof Error && err.message === "structuredData must be valid JSON") {
      return res.status(400).json({ error: err.message });
    }
    req.log.error(err, "Failed to create SEO page");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /seo/pages/:id — admin: update page SEO config
router.patch("/pages/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [page] = await db
      .update(seoPagesTable)
      .set({ ...toDbBody(req.body), updatedAt: new Date() })
      .where(eq(seoPagesTable.id, id))
      .returning();
    if (!page) return res.status(404).json({ error: "Not found" });
    return res.json(toApiPage(page));
  } catch (err) {
    if (err instanceof Error && err.message === "structuredData must be valid JSON") {
      return res.status(400).json({ error: err.message });
    }
    req.log.error(err, "Failed to update SEO page");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /seo/pages/:id — admin
router.delete("/pages/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    await db.delete(seoPagesTable).where(eq(seoPagesTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete SEO page");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Redirects (admin CRUD)
// ---------------------------------------------------------------------------

// GET /seo/redirects — admin: list all redirects
router.get("/redirects", requireAdmin, async (req, res) => {
  try {
    const redirects = await db.select().from(seoRedirectsTable).orderBy(seoRedirectsTable.fromPath);
    return res.json(redirects);
  } catch (err) {
    req.log.error(err, "Failed to list SEO redirects");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /seo/redirects/active — public: list active redirects, used by the
// frontend router to perform client-side redirects.
router.get("/redirects/active", async (req, res) => {
  try {
    const redirects = await db.select().from(seoRedirectsTable).where(eq(seoRedirectsTable.isActive, true));
    return res.json(redirects);
  } catch (err) {
    req.log.error(err, "Failed to list active SEO redirects");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /seo/redirects — admin: create redirect
router.post("/redirects", requireAdmin, async (req, res) => {
  const { fromPath, toPath } = req.body as { fromPath?: string; toPath?: string };
  if (!fromPath || !toPath) return res.status(400).json({ error: "fromPath and toPath are required" });

  try {
    const [redirect] = await db.insert(seoRedirectsTable).values(req.body).returning();
    return res.status(201).json(redirect);
  } catch (err) {
    req.log.error(err, "Failed to create SEO redirect");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /seo/redirects/:id — admin: update redirect
router.patch("/redirects/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [redirect] = await db
      .update(seoRedirectsTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(seoRedirectsTable.id, id))
      .returning();
    if (!redirect) return res.status(404).json({ error: "Not found" });
    return res.json(redirect);
  } catch (err) {
    req.log.error(err, "Failed to update SEO redirect");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /seo/redirects/:id — admin
router.delete("/redirects/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    await db.delete(seoRedirectsTable).where(eq(seoRedirectsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete SEO redirect");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Settings (singleton: robots.txt content, sitemap toggle, site URL)
// ---------------------------------------------------------------------------

// GET /seo/settings — admin: get site-wide SEO settings
router.get("/settings", requireAdmin, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    return res.json(settings);
  } catch (err) {
    req.log.error(err, "Failed to get SEO settings");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /seo/settings — admin: update site-wide SEO settings
router.patch("/settings", requireAdmin, async (req, res) => {
  try {
    await getOrCreateSettings();
    const [settings] = await db
      .update(seoSettingsTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(seoSettingsTable.id, 1))
      .returning();
    return res.json(settings);
  } catch (err) {
    req.log.error(err, "Failed to update SEO settings");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Public robots.txt / sitemap.xml
// ---------------------------------------------------------------------------

// GET /seo/robots.txt — public: serves the admin-edited robots.txt content.
// Also mounted at the site root (see app.ts) so real crawlers hitting
// `/robots.txt` get the admin-controlled content instead of a static file.
export async function robotsTxtHandler(req: Request, res: Response) {
  try {
    const settings = await getOrCreateSettings();
    res.type("text/plain").send(settings?.robotsTxt ?? DEFAULT_ROBOTS_TXT);
  } catch (err) {
    req.log.error(err, "Failed to serve robots.txt");
    res.type("text/plain").status(500).send(DEFAULT_ROBOTS_TXT);
  }
}

// GET /seo/sitemap.xml — public: generates a sitemap from seo_pages rows
// that are not marked noIndex, using seo_settings.siteUrl as the base.
// Also mounted at the site root (see app.ts) for the same reason as above.
export async function sitemapXmlHandler(req: Request, res: Response) {
  try {
    const settings = await getOrCreateSettings();
    if (settings && !settings.sitemapEnabled) {
      res.type("application/xml").status(404).send("<error>Sitemap disabled</error>");
      return;
    }

    const pages = await db.select().from(seoPagesTable).where(eq(seoPagesTable.noIndex, false));
    const siteUrl = (settings?.siteUrl ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

    const urls = pages.length > 0 ? pages : [{ path: "/", updatedAt: new Date() } as { path: string; updatedAt: Date }];

    const body = urls
      .map((p) => `  <url>\n    <loc>${siteUrl}${p.path}</loc>\n    <lastmod>${new Date(p.updatedAt).toISOString()}</lastmod>\n  </url>`)
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
    res.type("application/xml").send(xml);
  } catch (err) {
    req.log.error(err, "Failed to generate sitemap.xml");
    res.type("application/xml").status(500).send("<error>Failed to generate sitemap</error>");
  }
}

router.get("/robots.txt", robotsTxtHandler);
router.get("/sitemap.xml", sitemapXmlHandler);

export default router;
