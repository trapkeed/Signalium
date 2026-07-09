import { pgTable, integer, jsonb, timestamp, text } from "drizzle-orm/pg-core";

// Singleton (single-row, id fixed to 1) editable homepage/landing-page
// content. Stored as a single jsonb blob rather than one column per field —
// the landing page has dozens of nested strings/lists (hero copy, step
// cards, pillar cards, FAQ entries, etc.) and new sections get added to the
// page over time; a jsonb blob lets the admin editor and the page component
// evolve together without a migration for every new landing-page tweak.
// `content` is nullable: null means "no admin override yet, render the
// built-in defaults" (see DEFAULT_SITE_CONTENT on the frontend) rather than
// treating an empty/missing row as broken.
export const siteContentTable = pgTable("site_content", {
  id: integer("id").primaryKey().default(1),
  content: jsonb("content"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export type SiteContentRow = typeof siteContentTable.$inferSelect;
