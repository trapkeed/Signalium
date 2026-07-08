import { pgTable, text, serial, timestamp, integer, real, json, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { subscriptionsTable } from "./subscriptions";

export const paymentProvidersTable = pgTable("payment_providers", {
  id: serial("id").primaryKey(),
  type: text("type", { enum: ["usdt", "card", "bank_transfer"] }).notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  config: json("config").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  subscriptionId: integer("subscription_id").references(() => subscriptionsTable.id),
  providerId: integer("provider_id").notNull().references(() => paymentProvidersTable.id),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  status: text("status", { enum: ["pending", "submitted", "confirmed", "failed", "refunded"] }).notNull().default("pending"),
  reference: text("reference"),
  txHash: text("tx_hash"),
  proofUrl: text("proof_url"),
  notes: text("notes"),
  metadata: json("metadata").$type<Record<string, unknown>>().notNull().default({}),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPaymentProviderSchema = createInsertSchema(paymentProvidersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPaymentProvider = z.infer<typeof insertPaymentProviderSchema>;
export type PaymentProvider = typeof paymentProvidersTable.$inferSelect;

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
