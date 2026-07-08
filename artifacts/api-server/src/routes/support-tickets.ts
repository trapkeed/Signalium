import { Router } from "express";
import { Readable } from "stream";
import { getAuth } from "@clerk/express";
import { db, supportTicketsTable, supportTicketRepliesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAdmin, isAdmin } from "../middlewares/requireAdmin";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const objectStorageService = new ObjectStorageService();

// ---------------------------------------------------------------------------
// User-facing: own tickets
// ---------------------------------------------------------------------------

// GET /support/tickets — authenticated: list the current user's tickets
router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const tickets = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.userId, userId))
      .orderBy(desc(supportTicketsTable.updatedAt));
    return res.json(tickets);
  } catch (err) {
    req.log.error(err, "Failed to list support tickets");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /support/tickets — authenticated: create a ticket. `message` becomes
// the first reply in the thread (authorRole="user").
router.post("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { subject, message, priority, attachmentPath } = req.body as {
    subject?: string; message?: string; priority?: "low" | "normal" | "high" | "urgent"; attachmentPath?: string;
  };
  if (!subject || !message) return res.status(400).json({ error: "subject and message are required" });

  try {
    const [ticket] = await db
      .insert(supportTicketsTable)
      .values({ userId, subject, priority: priority ?? "normal" })
      .returning();

    if (attachmentPath) {
      await objectStorageService.trySetObjectEntityAclPolicy(attachmentPath, { owner: userId, visibility: "private" });
    }

    const [reply] = await db
      .insert(supportTicketRepliesTable)
      .values({ ticketId: ticket.id, authorId: userId, authorRole: "user", body: message, attachmentPath })
      .returning();

    return res.status(201).json({ ...ticket, replies: [reply] });
  } catch (err) {
    req.log.error(err, "Failed to create support ticket");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /support/tickets/attachments/request-url — authenticated: presigned
// upload URL for a ticket/reply attachment. ACL is set once the object is
// actually referenced by a ticket/reply (see above and the reply route
// below), since the object doesn't exist yet at request time.
router.post("/attachments/request-url", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    return res.json({ uploadURL, objectPath });
  } catch (err) {
    req.log.error(err, "Failed to generate ticket attachment upload URL");
    return res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ---------------------------------------------------------------------------
// Admin: ticket queue (mounted before /:id routes so "admin" never matches
// as a ticket id)
// ---------------------------------------------------------------------------

// GET /support/tickets/admin — admin: list all tickets, optionally filtered by status
router.get("/admin", requireAdmin, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const tickets = status
      ? await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.status, status as never)).orderBy(desc(supportTicketsTable.updatedAt))
      : await db.select().from(supportTicketsTable).orderBy(desc(supportTicketsTable.updatedAt));
    return res.json(tickets);
  } catch (err) {
    req.log.error(err, "Failed to list all support tickets");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /support/tickets/admin/:id — admin: update status/priority
router.patch("/admin/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { status, priority } = req.body as { status?: string; priority?: string };
  try {
    const [ticket] = await db
      .update(supportTicketsTable)
      .set({ ...(status && { status: status as never }), ...(priority && { priority: priority as never }), updatedAt: new Date() })
      .where(eq(supportTicketsTable.id, id))
      .returning();
    if (!ticket) return res.status(404).json({ error: "Not found" });
    return res.json(ticket);
  } catch (err) {
    req.log.error(err, "Failed to update support ticket");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Shared: ticket detail + replies (owner or admin)
// ---------------------------------------------------------------------------

type TicketLookupResult =
  | { error: 401 | 403 | 404 }
  | { ticket: typeof supportTicketsTable.$inferSelect; userId: string; isAdmin: boolean };

async function loadTicketForRequester(
  req: import("express").Request,
  id: number
): Promise<TicketLookupResult> {
  const { userId } = getAuth(req);
  if (!userId) return { error: 401 };

  const [ticket] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!ticket) return { error: 404 };

  const admin = await isAdmin(userId);
  if (ticket.userId !== userId && !admin) return { error: 403 };

  return { ticket, userId, isAdmin: admin };
}

// GET /support/tickets/:id — authenticated owner or admin: ticket + full thread
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const result = await loadTicketForRequester(req, id);
    if ("error" in result) return res.status(result.error).json({ error: result.error === 401 ? "Unauthorized" : result.error === 403 ? "Forbidden" : "Not found" });

    const replies = await db
      .select()
      .from(supportTicketRepliesTable)
      .where(eq(supportTicketRepliesTable.ticketId, id))
      .orderBy(supportTicketRepliesTable.createdAt);
    return res.json({ ...result.ticket, replies });
  } catch (err) {
    req.log.error(err, "Failed to get support ticket");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /support/tickets/:id/replies — authenticated owner or admin: add a reply
router.post("/:id/replies", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { body, attachmentPath } = req.body as { body?: string; attachmentPath?: string };
  if (!body) return res.status(400).json({ error: "body is required" });

  try {
    const result = await loadTicketForRequester(req, id);
    if ("error" in result) return res.status(result.error).json({ error: result.error === 401 ? "Unauthorized" : result.error === 403 ? "Forbidden" : "Not found" });

    if (attachmentPath) {
      await objectStorageService.trySetObjectEntityAclPolicy(attachmentPath, { owner: result.userId, visibility: "private" });
    }

    const [reply] = await db
      .insert(supportTicketRepliesTable)
      .values({
        ticketId: id,
        authorId: result.userId,
        authorRole: result.isAdmin ? "admin" : "user",
        body,
        attachmentPath,
      })
      .returning();

    // Replying reopens a resolved/closed ticket into "pending" (admin reply)
    // or "open" (user reply) so it resurfaces in the queue.
    await db
      .update(supportTicketsTable)
      .set({ status: result.isAdmin ? "pending" : "open", updatedAt: new Date() })
      .where(eq(supportTicketsTable.id, id));

    return res.status(201).json(reply);
  } catch (err) {
    req.log.error(err, "Failed to add support ticket reply");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /support/tickets/:id/replies/:replyId/attachment — authenticated
// owner or admin: stream an attachment. Ticket-scoped authorization (not
// the generic object ACL system) since attachments are private objects
// that both the ticket owner AND any admin must be able to read.
router.get("/:id/replies/:replyId/attachment", async (req, res) => {
  const id = Number(req.params.id);
  const replyId = Number(req.params.replyId);
  if (isNaN(id) || isNaN(replyId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const result = await loadTicketForRequester(req, id);
    if ("error" in result) return res.status(result.error).json({ error: result.error === 401 ? "Unauthorized" : result.error === 403 ? "Forbidden" : "Not found" });

    const [reply] = await db.select().from(supportTicketRepliesTable).where(and(eq(supportTicketRepliesTable.id, replyId), eq(supportTicketRepliesTable.ticketId, id)));
    if (!reply || !reply.attachmentPath) return res.status(404).json({ error: "Attachment not found" });

    const objectFile = await objectStorageService.getObjectEntityFile(reply.attachmentPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
    return;
  } catch (err) {
    req.log.error(err, "Failed to serve ticket attachment");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
