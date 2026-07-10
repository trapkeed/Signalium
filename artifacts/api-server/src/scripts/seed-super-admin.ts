/**
 * One-off seed: provisions the initial super_admin account directly in the
 * local `users` table (no Clerk). Idempotent — if the DB row already
 * exists, it is promoted to super_admin and its password reset instead of
 * duplicated.
 *
 * Usage:
 *   SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD='choose-a-strong-password' \
 *     pnpm --filter @workspace/api-server exec tsx src/scripts/seed-super-admin.ts
 *
 * Both env vars are required — the script refuses to run without them so no
 * default/shared credential ever ends up seeded.
 */
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { hashPassword } from "../lib/auth";

const EMAIL = process.env.SUPER_ADMIN_EMAIL;
const PASSWORD = process.env.SUPER_ADMIN_PASSWORD;

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error(
      "Missing SUPER_ADMIN_EMAIL and/or SUPER_ADMIN_PASSWORD environment variables.\n" +
      "Usage: SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD='strong-password' " +
      "pnpm --filter @workspace/api-server exec tsx src/scripts/seed-super-admin.ts"
    );
    process.exit(1);
  }
  if (PASSWORD.length < 12) {
    console.error("SUPER_ADMIN_PASSWORD must be at least 12 characters.");
    process.exit(1);
  }

  console.log(`Seeding super admin: ${EMAIL}`);

  const passwordHash = await hashPassword(PASSWORD);
  const [existingRow] = await db.select().from(usersTable).where(eq(usersTable.email, EMAIL));

  if (existingRow) {
    await db.update(usersTable)
      .set({ role: "super_admin", isActive: true, passwordHash, emailVerified: true })
      .where(eq(usersTable.id, existingRow.id));
    console.log("Updated existing DB row to super_admin.");
  } else {
    await db.insert(usersTable).values({
      email: EMAIL,
      passwordHash,
      emailVerified: true,
      role: "super_admin",
      isActive: true,
      referralCode: crypto.randomBytes(6).toString("hex"),
    });
    console.log("Inserted new DB row as super_admin.");
  }

  console.log("Done. Super admin is ready to sign in.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to seed super admin:", err);
  process.exit(1);
});
