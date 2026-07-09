import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A user-submitted support ticket. The ticket's initial description is
// stored as the first row in supportTicketRepliesTable (authorRole="user")
// rather than a separate column, so the thread view is just "list replies".
export const supportTicketsTable = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  subject: text("subject").notNull(),
  status: text("status", { enum: ["open", "pending", "resolved", "closed"] }).notNull().default("open"),
  priority: text("priority", { enum: ["low", "normal", "high", "urgent"] }).notNull().default("normal"),
  // S30 — issue categorization, used for queue filtering/routing. Free-form
  // enough to cover the common cases without a separate lookup table.
  category: text("category", { enum: ["billing", "technical", "ea_broker", "account", "other"] }).notNull().default("other"),
  // S30 — explicit agent assignment (nullable = unassigned, shared queue).
  assignedAdminId: text("assigned_admin_id"),
  // S30 — set when priority is bumped via the explicit escalate action
  // (as opposed to the implicit reopen-on-reply behavior below).
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("support_tickets_user_id_idx").on(table.userId),
  index("support_tickets_assigned_admin_id_idx").on(table.assignedAdminId),
]);

export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({ id: true, createdAt: true, updatedAt: true, status: true });
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTicketsTable.$inferSelect;

// One row per message in a ticket's thread — the initial submission (from
// the user) and every subsequent reply (from either the ticket owner or an
// admin). `attachmentPath` optionally points into object storage (see
// support-tickets.ts for the ticket-scoped upload/serve flow, which
// authorizes by ticket ownership rather than the generic object ACL system).
export const supportTicketRepliesTable = pgTable("support_ticket_replies", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  authorId: text("author_id").notNull(),
  authorRole: text("author_role", { enum: ["user", "admin"] }).notNull(),
  body: text("body").notNull(),
  attachmentPath: text("attachment_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("support_ticket_replies_ticket_id_idx").on(table.ticketId),
]);

export const insertSupportTicketReplySchema = createInsertSchema(supportTicketRepliesTable).omit({ id: true, createdAt: true });
export type InsertSupportTicketReply = z.infer<typeof insertSupportTicketReplySchema>;
export type SupportTicketReply = typeof supportTicketRepliesTable.$inferSelect;

// Anonymous/public contact form submissions. Not tied to a user account —
// routed to admins via this queue (and, once SMTP is fully wired for
// outbound send, notified by email); kept separate from supportTicketsTable
// since submitters aren't authenticated.
export const contactMessagesTable = pgTable("contact_messages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  status: text("status", { enum: ["new", "handled"] }).notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContactMessageSchema = createInsertSchema(contactMessagesTable).omit({ id: true, createdAt: true, status: true });
export type InsertContactMessage = z.infer<typeof insertContactMessageSchema>;
export type ContactMessage = typeof contactMessagesTable.$inferSelect;
