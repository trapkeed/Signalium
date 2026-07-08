import { Router } from "express";
import { Readable } from "stream";
import { getAuth } from "@clerk/express";
import { db, invoicesTable, invoiceItemsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { ensureInvoicePdf } from "../lib/payments/invoices";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();

router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.userId, userId)).orderBy(desc(invoicesTable.issuedAt));
    return res.json(invoices);
  } catch (err) {
    req.log.error(err, "Failed to list invoices");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/all", requireAdmin, async (req, res) => {
  try {
    const invoices = await db.select().from(invoicesTable).orderBy(desc(invoicesTable.issuedAt));
    return res.json(invoices);
  } catch (err) {
    req.log.error(err, "Failed to list all invoices");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!invoice) return res.status(404).json({ error: "Not found" });
    if (invoice.userId !== userId) return res.status(403).json({ error: "Forbidden" });
    const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, id));
    return res.json({ ...invoice, items });
  } catch (err) {
    req.log.error(err, "Failed to get invoice");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/pdf", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!invoice) return res.status(404).json({ error: "Not found" });
    if (invoice.userId !== userId) return res.status(403).json({ error: "Forbidden" });

    const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, id));
    const objectPath = await ensureInvoicePdf(invoice, items);

    const service = new ObjectStorageService();
    const file = await service.getObjectEntityFile(objectPath);
    const response = await service.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    if (response.body) {
      Readable.fromWeb(response.body as never).pipe(res);
    } else {
      res.end();
    }
    return;
  } catch (err) {
    req.log.error(err, "Failed to download invoice PDF");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
