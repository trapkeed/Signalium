/**
 * One-off seed: provisions the initial super_admin account directly in the
 * local `users` table (no Clerk). Idempotent — if the DB row already
 * exists, it is promoted to super_admin and its password reset instead of
 * duplicated.
 *
 * Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/seed-super-admin.ts
 */
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { hashPassword } from "../lib/auth";

const EMAIL = "t3002843@gmail.com";
const PASSWORD = "Chachabrian2001/";

async function main() {
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
