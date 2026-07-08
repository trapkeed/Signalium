/**
 * One-off migration: moves the SPA's static robots.txt / opengraph.jpg /
 * favicon.svg into the DB-backed SEO & media system (media_assets,
 * seo_settings, seo_pages) so they become admin-editable.
 *
 * Idempotent — safe to re-run; it upserts by well-known fileName/path values.
 *
 * Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/migrate-static-seo-assets.ts
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, mediaAssetsTable, seoSettingsTable, seoPagesTable } from "@workspace/db";
import { objectStorageClient, ObjectStorageService } from "../lib/objectStorage";

// Resolved relative to the repo root (process.cwd() when run via
// `pnpm --filter @workspace/api-server exec ...`, which is artifacts/api-server).
const PUBLIC_DIR = resolve(process.cwd(), "../signalium/public");

function parseObjectPath(fullPath: string): { bucketName: string; objectName: string } {
  const withoutLeading = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
  const parts = withoutLeading.split("/");
  const bucketName = parts[0];
  const objectName = parts.slice(1).join("/");
  return { bucketName, objectName };
}

async function uploadLocalFile(
  localPath: string,
  contentType: string,
  objectStorageService: ObjectStorageService,
): Promise<string> {
  const privateObjectDir = objectStorageService.getPrivateObjectDir();
  const objectId = randomUUID();
  const fullPath = `${privateObjectDir}/uploads/${objectId}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);

  const buffer = readFileSync(localPath);
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  await file.save(buffer, { contentType });

  const objectPath = `/objects/uploads/${objectId}`;
  // These assets back public SEO surfaces (favicon, OG image) that must be
  // fetchable by crawlers/anonymous visitors — same policy POST /media sets
  // for admin-uploaded assets. Without this, GET /storage/objects/* (which
  // enforces ACL) would 403 everyone.
  await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
    owner: "migration-script",
    visibility: "public",
  });

  return objectPath;
}

async function upsertMediaAsset(input: {
  objectPath: string;
  fileName: string;
  contentType: string;
  size: number;
  category: "favicon" | "logo" | "hero" | "social" | "marketing" | "other";
}): Promise<{ objectPath: string }> {
  const [existing] = await db
    .select()
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.fileName, input.fileName));

  if (existing) {
    console.log(`  media asset already migrated: ${input.fileName} -> ${existing.objectPath}`);
    return existing;
  }

  const [created] = await db.insert(mediaAssetsTable).values(input).returning();
  console.log(`  migrated media asset: ${input.fileName} -> ${created.objectPath}`);
  return created;
}

async function main() {
  const objectStorageService = new ObjectStorageService();

  console.log("Migrating static SEO/media assets into the DB-backed system...");

  // 1. robots.txt -> seo_settings.robotsTxt
  const robotsPath = resolve(PUBLIC_DIR, "robots.txt");
  const robotsTxt = existsSync(robotsPath)
    ? readFileSync(robotsPath, "utf-8")
    : "User-agent: *\nAllow: /\n";

  const [existingSettings] = await db.select().from(seoSettingsTable).where(eq(seoSettingsTable.id, 1));
  if (!existingSettings) {
    await db.insert(seoSettingsTable).values({ id: 1, robotsTxt, sitemapEnabled: true }).onConflictDoNothing();
    console.log("  seeded seo_settings from static robots.txt");
  } else {
    console.log("  seo_settings already exists, leaving as-is");
  }

  // 2. opengraph.jpg -> object storage + media_assets (category: social)
  let ogImagePath: string | null = null;
  const ogLocalPath = resolve(PUBLIC_DIR, "opengraph.jpg");
  if (existsSync(ogLocalPath)) {
    const size = readFileSync(ogLocalPath).byteLength;
    const [existingOg] = await db
      .select()
      .from(mediaAssetsTable)
      .where(eq(mediaAssetsTable.fileName, "opengraph.jpg"));

    if (existingOg) {
      ogImagePath = existingOg.objectPath;
      // Re-run-safe: earlier runs of this script (before ACL enforcement
      // was added to GET /storage/objects/*) may have left this object
      // without a public ACL policy, which would now 403 it. Reassert it.
      await objectStorageService.trySetObjectEntityAclPolicy(ogImagePath, {
        owner: "migration-script",
        visibility: "public",
      });
      console.log(`  media asset already migrated: opengraph.jpg -> ${ogImagePath}`);
    } else {
      const objectPath = await uploadLocalFile(ogLocalPath, "image/jpeg", objectStorageService);
      const asset = await upsertMediaAsset({
        objectPath,
        fileName: "opengraph.jpg",
        contentType: "image/jpeg",
        size,
        category: "social",
      });
      ogImagePath = asset.objectPath;
    }
  }

  // 3. favicon.svg -> object storage + media_assets (category: favicon)
  const faviconLocalPath = resolve(PUBLIC_DIR, "favicon.svg");
  if (existsSync(faviconLocalPath)) {
    const size = readFileSync(faviconLocalPath).byteLength;
    const [existingFavicon] = await db
      .select()
      .from(mediaAssetsTable)
      .where(eq(mediaAssetsTable.fileName, "favicon.svg"));

    if (!existingFavicon) {
      const objectPath = await uploadLocalFile(faviconLocalPath, "image/svg+xml", objectStorageService);
      await upsertMediaAsset({
        objectPath,
        fileName: "favicon.svg",
        contentType: "image/svg+xml",
        size,
        category: "favicon",
      });
    } else {
      // See the opengraph.jpg branch above — reassert ACL for re-runs.
      await objectStorageService.trySetObjectEntityAclPolicy(existingFavicon.objectPath, {
        owner: "migration-script",
        visibility: "public",
      });
      console.log(`  media asset already migrated: favicon.svg -> ${existingFavicon.objectPath}`);
    }
  }

  // 4. Seed a "home" seo_pages row ("/") from index.html's static meta tags,
  // using the migrated opengraph.jpg as its default OG/Twitter image.
  const ogImageUrl = ogImagePath ? `/api/storage${ogImagePath}` : undefined;
  const [existingHomePage] = await db.select().from(seoPagesTable).where(eq(seoPagesTable.path, "/"));
  if (!existingHomePage) {
    await db.insert(seoPagesTable).values({
      path: "/",
      title: "Signalium",
      description: "Signalium — built on Replit. Update this description to reflect the app.",
      ogTitle: "Signalium",
      ogDescription: "Signalium — built on Replit. Update this description to reflect the app.",
      ogImage: ogImageUrl,
      twitterCard: "summary_large_image",
      twitterTitle: "Signalium",
      twitterDescription: "Signalium — built on Replit. Update this description to reflect the app.",
      twitterImage: ogImageUrl,
    });
    console.log("  seeded seo_pages row for path \"/\" from index.html meta tags");
  } else if (!existingHomePage.ogImage && ogImageUrl) {
    await db
      .update(seoPagesTable)
      .set({ ogImage: ogImageUrl, twitterImage: ogImageUrl, updatedAt: new Date() })
      .where(eq(seoPagesTable.path, "/"));
    console.log("  backfilled ogImage/twitterImage on existing seo_pages row for \"/\"");
  } else {
    console.log("  seo_pages row for \"/\" already exists, leaving as-is");
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
