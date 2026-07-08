import { pgTable, text, serial, timestamp, integer, real, json, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { subscriptionsTable } from "./subscriptions";
import { plansTable } from "./plans";

// One row per payment method Signalium can accept. USDT is split into one row
// per network (trc20/erc20/bep20) since each has its own wallet address and
// confirmation threshold; Stripe/PayPal/Flutterwave are one row each. `type`
// is the PaymentProvider registry key (see providers/ in api-server) — routes
// never branch on provider name, only on this key.
export const paymentProvidersTable = pgTable("payment_providers", {
  id: serial("id").primaryKey(),
  type: text("type", {
    enum: ["usdt_trc20", "usdt_erc20", "usdt_bep20", "stripe", "paypal", "flutterwave"],
  }).notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  // Provider-specific settings an admin can edit (wallet address + required
  // confirmations for USDT networks; display-only settings for card
  // providers — actual API credentials for card providers come from Replit
  // connectors/secrets, never stored here).
  config: json("config").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  subscriptionId: integer("subscription_id").references(() => subscriptionsTable.id),
  planId: integer("plan_id").references(() => plansTable.id),
  providerId: integer("provider_id").notNull().references(() => paymentProvidersTable.id),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  // PENDING: intent created, awaiting payer action.
  // CONFIRMING: payer action taken (tx broadcast / checkout completed), we
  //   are waiting on confirmations (USDT) or provider webhook finality.
  // CONFIRMED / FAILED / EXPIRED / REFUNDED: terminal states.
  status: text("status", {
    enum: ["pending", "confirming", "confirmed", "failed", "expired", "refunded"],
  }).notNull().default("pending"),
  reference: text("reference"),
  // USDT-specific tracking. Null for card providers.
  network: text("network", { enum: ["trc20", "erc20", "bep20"] }),
  walletAddress: text("wallet_address"),
  txHash: text("tx_hash"),
  confirmations: integer("confirmations").notNull().default(0),
  requiredConfirmations: integer("required_confirmations"),
  // Card-provider tracking. Null for USDT.
  externalReference: text("external_reference"),
  proofUrl: text("proof_url"),
  notes: text("notes"),
  metadata: json("metadata").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  // Set when an admin refunds a confirmed payment (see routes/payments.ts POST /:id/refund).
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  refundNotes: text("refund_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Replay protection + dedup for provider webhooks. `externalId` is the
// provider's own event/transaction id (Stripe event id, PayPal webhook id,
// Flutterwave tx ref, or a USDT tx hash for manually/relay-reported
// confirmations). The unique constraint on (provider, externalId) is what
// actually prevents double-processing — a webhook retried by the provider,
// or a malicious replay of a captured payload, is rejected at the DB layer
// before any payment/subscription mutation runs.
export const webhookEventsTable = pgTable("webhook_events", {
  id: serial("id").primaryKey(),
  provider: text("provider", {
    enum: ["usdt_trc20", "usdt_erc20", "usdt_bep20", "stripe", "paypal", "flutterwave"],
  }).notNull(),
  externalId: text("external_id").notNull(),
  payloadHash: text("payload_hash").notNull(),
  status: text("status", { enum: ["received", "processed", "failed", "ignored"] }).notNull().default("received"),
  error: text("error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => ({
  providerExternalIdUnique: unique().on(table.provider, table.externalId),
}));

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  userId: text("user_id").notNull(),
  subscriptionId: integer("subscription_id").references(() => subscriptionsTable.id),
  paymentId: integer("payment_id").references(() => paymentsTable.id),
  planId: integer("plan_id").references(() => plansTable.id),
  currency: text("currency").notNull().default("USD"),
  amount: real("amount").notNull(),
  status: text("status", { enum: ["draft", "issued", "paid", "void"] }).notNull().default("issued"),
  // What triggered this invoice — subscription create/renew/upgrade/downgrade.
  reason: text("reason", {
    enum: ["subscription_created", "subscription_renewed", "subscription_upgraded", "subscription_downgraded"],
  }).notNull(),
  provider: text("provider"),
  paymentReference: text("payment_reference"),
  // Object-storage path to the generated PDF, populated lazily on first
  // download request (see invoices.ts) rather than at issue time.
  pdfObjectPath: text("pdf_object_path"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // At most one invoice per payment (NULLs — e.g. manually-issued invoices
  // with no linked payment — are exempt under standard SQL unique
  // semantics). This is also what makes `applySuccessfulPayment` safe to
  // retry: a second attempt to invoice the same payment fails the insert
  // instead of silently double-billing.
  paymentIdUnique: unique().on(table.paymentId),
}));

export const invoiceItemsTable = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitAmount: real("unit_amount").notNull(),
  amount: real("amount").notNull(),
});

export const insertPaymentProviderSchema = createInsertSchema(paymentProvidersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPaymentProvider = z.infer<typeof insertPaymentProviderSchema>;
export type PaymentProviderRow = typeof paymentProvidersTable.$inferSelect;

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;

export const insertWebhookEventSchema = createInsertSchema(webhookEventsTable).omit({ id: true, receivedAt: true });
export type InsertWebhookEvent = z.infer<typeof insertWebhookEventSchema>;
export type WebhookEvent = typeof webhookEventsTable.$inferSelect;

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;

export const insertInvoiceItemSchema = createInsertSchema(invoiceItemsTable).omit({ id: true });
export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;
export type InvoiceItem = typeof invoiceItemsTable.$inferSelect;
