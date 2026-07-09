import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, kbCategoriesTable, kbArticlesTable } from "@workspace/db";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";

const router = Router();

// ---------------------------------------------------------------------------
// Public: browse/search published content (mounted before admin/:id routes
// is not a concern here since public routes use distinct literal segments)
// ---------------------------------------------------------------------------

// GET /kb/categories — public: categories with their published article count
router.get("/categories", async (req, res) => {
  try {
    const categories = await db.select().from(kbCategoriesTable).orderBy(asc(kbCategoriesTable.sortOrder));
    const articles = await db.select({ id: kbArticlesTable.id, categoryId: kbArticlesTable.categoryId }).from(kbArticlesTable).where(eq(kbArticlesTable.status, "published"));
    const counts = new Map<number, number>();
    for (const a of articles) counts.set(a.categoryId, (counts.get(a.categoryId) ?? 0) + 1);
    return res.json(categories.map((c) => ({ ...c, articleCount: counts.get(c.id) ?? 0 })));
  } catch (err) {
    req.log.error(err, "Failed to list KB categories");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /kb/articles — public: published articles, optionally filtered by
// categorySlug and/or full-text `q` search across title/body
router.get("/articles", async (req, res) => {
  try {
    const q = req.query.q ? String(req.query.q) : undefined;
    const categorySlug = req.query.categorySlug ? String(req.query.categorySlug) : undefined;

    let categoryId: number | undefined;
    if (categorySlug) {
      const [category] = await db.select().from(kbCategoriesTable).where(eq(kbCategoriesTable.slug, categorySlug));
      if (!category) return res.json([]);
      categoryId = category.id;
    }

    const conditions = [eq(kbArticlesTable.status, "published")];
    if (categoryId !== undefined) conditions.push(eq(kbArticlesTable.categoryId, categoryId));
    if (q) conditions.push(or(ilike(kbArticlesTable.title, `%${q}%`), ilike(kbArticlesTable.body, `%${q}%`))!);

    const articles = await db.select().from(kbArticlesTable).where(and(...conditions)).orderBy(desc(kbArticlesTable.updatedAt));
    return res.json(articles);
  } catch (err) {
    req.log.error(err, "Failed to list KB articles");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /kb/articles/:slug — public: a single published article
router.get("/articles/:slug", async (req, res) => {
  try {
    const [article] = await db.select().from(kbArticlesTable).where(and(eq(kbArticlesTable.slug, req.params.slug), eq(kbArticlesTable.status, "published")));
    if (!article) return res.status(404).json({ error: "Not found" });
    return res.json(article);
  } catch (err) {
    req.log.error(err, "Failed to get KB article");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Admin: category + article authoring
// ---------------------------------------------------------------------------

router.get("/admin/categories", requireAdmin, async (req, res) => {
  try {
    const categories = await db.select().from(kbCategoriesTable).orderBy(asc(kbCategoriesTable.sortOrder));
    return res.json(categories);
  } catch (err) {
    req.log.error(err, "Failed to list KB categories (admin)");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/categories", requireAdmin, async (req, res) => {
  const { name, slug } = req.body as { name?: string; slug?: string };
  if (!name || !slug) return res.status(400).json({ error: "name and slug are required" });

  try {
    const [category] = await db.insert(kbCategoriesTable).values(req.body).returning();
    return res.status(201).json(category);
  } catch (err) {
    req.log.error(err, "Failed to create KB category");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/categories/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [category] = await db.update(kbCategoriesTable).set(req.body).where(eq(kbCategoriesTable.id, id)).returning();
    if (!category) return res.status(404).json({ error: "Not found" });
    return res.json(category);
  } catch (err) {
    req.log.error(err, "Failed to update KB category");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/categories/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    await db.delete(kbArticlesTable).where(eq(kbArticlesTable.categoryId, id));
    await db.delete(kbCategoriesTable).where(eq(kbCategoriesTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete KB category");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/articles", requireAdmin, async (req, res) => {
  try {
    const articles = await db.select().from(kbArticlesTable).orderBy(desc(kbArticlesTable.updatedAt));
    return res.json(articles);
  } catch (err) {
    req.log.error(err, "Failed to list KB articles (admin)");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/articles", requireAdmin, async (req, res) => {
  const { categoryId, title, slug, body } = req.body as { categoryId?: number; title?: string; slug?: string; body?: string };
  if (!categoryId || !title || !slug || !body) return res.status(400).json({ error: "categoryId, title, slug, and body are required" });

  try {
    const [article] = await db.insert(kbArticlesTable).values(req.body).returning();
    return res.status(201).json(article);
  } catch (err) {
    req.log.error(err, "Failed to create KB article");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/articles/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [before] = await db.select().from(kbArticlesTable).where(eq(kbArticlesTable.id, id));
    if (!before) return res.status(404).json({ error: "Not found" });

    const [article] = await db.update(kbArticlesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(kbArticlesTable.id, id)).returning();
    if (!article) return res.status(404).json({ error: "Not found" });

    const status = req.body?.status as string | undefined;
    if (status && status !== before.status && (status === "published" || before.status === "published")) {
      await logAudit(
        actorUserId,
        status === "published" ? "knowledge_base.published" : "knowledge_base.unpublished",
        "knowledge_base_article",
        String(article.id),
        { title: article.title, from: before.status, to: status },
      );
    }

    return res.json(article);
  } catch (err) {
    req.log.error(err, "Failed to update KB article");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/articles/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    await db.delete(kbArticlesTable).where(eq(kbArticlesTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete KB article");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
