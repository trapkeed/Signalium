import crypto from "crypto";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid ambiguity
const CODE_LENGTH = 8;

function randomCode(): string {
  let code = "";
  for (const byte of crypto.randomBytes(CODE_LENGTH)) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

/** Generates a referral code guaranteed unused in usersTable (retries on the rare collision). */
export async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.referralCode, code));
    if (!existing) return code;
  }
  throw new Error("Failed to generate a unique referral code");
}
