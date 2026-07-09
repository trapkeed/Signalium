/**
 * One-off seed: provisions the initial super_admin account (Clerk + DB
 * mirror), same shape as `POST /users`. Idempotent — if the Clerk user or DB
 * row already exists, it is promoted to super_admin instead of duplicated.
 *
 * Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/seed-super-admin.ts
 */
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, usersTable } from "@workspace/db";

const EMAIL = "t3002843@gmail.com";
const PASSWORD = "Chachabrian2001/";

async function main() {
  console.log(`Seeding super admin: ${EMAIL}`);

  const existing = await clerkClient.users.getUserList({ emailAddress: [EMAIL] });
  let clerkUserId: string;

  if (existing.data.length > 0) {
    clerkUserId = existing.data[0].id;
    console.log(`Clerk user already exists (${clerkUserId}) — updating role + password.`);
    await clerkClient.users.updateUser(clerkUserId, {
      password: PASSWORD,
      publicMetadata: { role: "super_admin" },
    });
  } else {
    const clerkUser = await clerkClient.users.createUser({
      emailAddress: [EMAIL],
      password: PASSWORD,
      publicMetadata: { role: "super_admin" },
    });
    clerkUserId = clerkUser.id;
    console.log(`Created Clerk user ${clerkUserId}.`);
  }

  const [existingRow] = await db.select().from(usersTable).where(eq(usersTable.id, clerkUserId));

  if (existingRow) {
    await db.update(usersTable)
      .set({ role: "super_admin", isActive: true })
      .where(eq(usersTable.id, clerkUserId));
    console.log("Updated existing DB row to super_admin.");
  } else {
    await db.insert(usersTable).values({
      id: clerkUserId,
      email: EMAIL,
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
