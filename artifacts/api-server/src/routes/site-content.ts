import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, siteContentTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";

const router = Router();

// Strict shape for the admin-editable homepage content — mirrors
// SiteContentData on the frontend (see signalium/src/lib/site-content.ts).
// Validating every nested field here (rather than just "is it an object")
// means a malformed/hand-crafted PATCH body is rejected with a 400 instead
// of being stored and later crashing the public homepage render.
const titledItem = z.object({ title: z.string(), desc: z.string() });
const siteContentSchema = z.object({
  hero: z.object({
    badge: z.string(),
    headline: z.string(),
    subheadline: z.string(),
    primaryCtaLabel: z.string(),
    secondaryCtaLabel: z.string(),
  }),
  howItWorks: z.object({ eyebrow: z.string(), heading: z.string(), steps: z.array(titledItem) }),
  tradingModes: z.object({
    eyebrow: z.string(),
    heading: z.string(),
    manual: z.object({ title: z.string(), desc: z.string(), bullets: z.array(z.string()) }),
    autonomous: z.object({ title: z.string(), desc: z.string(), bullets: z.array(z.string()) }),
  }),
  pillars: z.object({ eyebrow: z.string(), heading: z.string(), items: z.array(titledItem) }),
  security: z.object({
    eyebrow: z.string(),
    heading: z.string(),
    body: z.string(),
    bullets: z.array(z.string()),
    badges: z.array(z.string()),
  }),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  cta: z.object({ heading: z.string(), body: z.string(), buttonLabel: z.string() }),
});

/**
 * Homepage/landing-page content CMS (singleton row, id=1).
 *
 * `content` is transmitted over the wire as a JSON *string* (not an
 * open-ended OpenAPI object) — same convention as seo.ts's
 * `structuredData` — so the generated zod/orval types stay closed-shaped.
 * The actual nested shape (hero copy, step cards, FAQ entries, etc.) is
 * defined once on the frontend (see `lib/site-content.ts`) and parsed there.
 */

async function getRow() {
  const [existing] = await db.select().from(siteContentTable).where(eq(siteContentTable.id, 1));
  return existing ?? null;
}

// GET /site-content — public: current homepage content override, or null
// if the admin has never customized it (frontend falls back to defaults).
router.get("/", async (req, res) => {
  try {
    const row = await getRow();
    return res.json({
      content: row?.content ? JSON.stringify(row.content) : null,
      updatedAt: row?.updatedAt ?? null,
    });
  } catch (err) {
    req.log.error(err, "Failed to load site content");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /site-content — admin: replace the homepage content override.
// `content: null` resets the homepage back to the built-in defaults.
router.patch("/", requireAdmin, async (req, res) => {
  const { userId: actorId } = getAuth(req);
  if (!actorId) return res.status(401).json({ error: "Unauthorized" });

  const { content } = req.body as { content?: string | null };
  let parsed: z.infer<typeof siteContentSchema> | null = null;
  if (content !== undefined && content !== null) {
    if (typeof content !== "string") return res.status(400).json({ error: "content must be a JSON string or null" });
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(content);
    } catch {
      return res.status(400).json({ error: "content must be valid JSON" });
    }
    const result = siteContentSchema.safeParse(rawParsed);
    if (!result.success) {
      return res.status(400).json({ error: "content does not match the expected homepage content shape", detail: result.error.issues.slice(0, 5) });
    }
    parsed = result.data;
  }

  try {
    const [row] = await db
      .insert(siteContentTable)
      .values({ id: 1, content: parsed, updatedBy: actorId })
      .onConflictDoUpdate({ target: siteContentTable.id, set: { content: parsed, updatedBy: actorId, updatedAt: new Date() } })
      .returning();

    await logAudit(actorId, parsed === null ? "site_content.reset" : "site_content.updated", "site_content", "1", {
      sections: parsed && typeof parsed === "object" ? Object.keys(parsed as Record<string, unknown>) : [],
    });

    return res.json({ content: row.content ? JSON.stringify(row.content) : null, updatedAt: row.updatedAt });
  } catch (err) {
    req.log.error(err, "Failed to update site content");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
