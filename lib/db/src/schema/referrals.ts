import { pgTable, text, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One row per successfully-attributed referral. Attribution happens once, at
// user-provisioning time (see account-security.ts sync-login), since that is
// the only point a brand-new user row is created. A referred user can only
// ever appear once (uniqueIndex), which also blocks a user from being
// "re-referred" after the fact.
export const referralsTable = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerUserId: text("referrer_user_id").notNull(),
  referredUserId: text("referred_user_id").notNull(),
  referralCode: text("referral_code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("referrals_referred_user_idx").on(table.referredUserId),
]);

export const insertReferralSchema = createInsertSchema(referralsTable).omit({ id: true, createdAt: true });
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referralsTable.$inferSelect;
