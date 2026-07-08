import PDFDocument from "pdfkit";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, invoicesTable, invoiceItemsTable, type Invoice, type PaymentProviderRow } from "@workspace/db";
import { objectStorageClient, ObjectStorageService } from "../objectStorage";
import { logger } from "../logger";

type DbOrTx = Pick<typeof db, "insert" | "select" | "update">;

/**
 * Auto-invoicing: every subscription-affecting payment event (create,
 * renew, upgrade, downgrade) gets exactly one invoice. The PDF is rendered
 * lazily on first download (see routes/invoices.ts) and cached to object
 * storage — invoice numbers/records are always created eagerly so the
 * billing history is accurate even before a PDF has ever been requested.
 */

export interface InvoiceLineItem {
  description: string;
  quantity?: number;
  unitAmount: number;
}

export interface CreateInvoiceInput {
  userId: string;
  subscriptionId: number;
  paymentId: number | null;
  planId: number;
  provider: PaymentProviderRow["type"] | null;
  paymentReference: string | null;
  currency: string;
  reason: "subscription_created" | "subscription_renewed" | "subscription_upgraded" | "subscription_downgraded";
  items: InvoiceLineItem[];
}

function generateInvoiceNumber(): string {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `INV-${yyyymm}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createInvoice(input: CreateInvoiceInput, client: DbOrTx = db): Promise<Invoice> {
  const amount = input.items.reduce((sum, item) => sum + item.unitAmount * (item.quantity ?? 1), 0);

  const [invoice] = await client.insert(invoicesTable).values({
    invoiceNumber: generateInvoiceNumber(),
    userId: input.userId,
    subscriptionId: input.subscriptionId,
    paymentId: input.paymentId,
    planId: input.planId,
    currency: input.currency,
    amount,
    status: input.paymentId ? "paid" : "issued",
    reason: input.reason,
    provider: input.provider,
    paymentReference: input.paymentReference,
    paidAt: input.paymentId ? new Date() : null,
  }).returning();

  if (input.items.length > 0) {
    await client.insert(invoiceItemsTable).values(
      input.items.map((item) => ({
        invoiceId: invoice.id,
        description: item.description,
        quantity: item.quantity ?? 1,
        unitAmount: item.unitAmount,
        amount: item.unitAmount * (item.quantity ?? 1),
      })),
    );
  }

  logger.info({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, userId: input.userId }, "Invoice issued");
  return invoice;
}

function renderInvoicePdf(invoice: Invoice, items: { description: string; quantity: number; unitAmount: number; amount: number }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Signalium", { continued: false });
    doc.fontSize(10).fillColor("#555").text("Invoice", { align: "right" }).moveUp().fontSize(20).fillColor("#000");
    doc.moveDown();

    doc.fontSize(12).text(`Invoice #: ${invoice.invoiceNumber}`);
    doc.text(`Issued: ${invoice.issuedAt.toISOString().slice(0, 10)}`);
    doc.text(`Status: ${invoice.status.toUpperCase()}`);
    if (invoice.paymentReference) doc.text(`Reference: ${invoice.paymentReference}`);
    if (invoice.provider) doc.text(`Provider: ${invoice.provider}`);
    doc.moveDown();

    doc.fontSize(12).text("Items", { underline: true });
    doc.moveDown(0.5);
    for (const item of items) {
      doc.fontSize(11).text(
        `${item.description}  x${item.quantity}  —  ${item.amount.toFixed(2)} ${invoice.currency}`,
      );
    }
    doc.moveDown();
    doc.fontSize(13).text(`Total: ${invoice.amount.toFixed(2)} ${invoice.currency}`, { align: "right" });

    doc.end();
  });
}

/** Renders (if not already cached) and returns the object-storage path for an invoice's PDF. */
export async function ensureInvoicePdf(
  invoice: Invoice,
  items: { description: string; quantity: number; unitAmount: number; amount: number }[],
): Promise<string> {
  if (invoice.pdfObjectPath) return invoice.pdfObjectPath;

  const service = new ObjectStorageService();
  const privateDir = service.getPrivateObjectDir();
  const objectId = randomUUID();
  const objectName = `invoices/${objectId}.pdf`;

  const bucketAndPrefix = privateDir.replace(/^\//, "").split("/");
  const bucketName = bucketAndPrefix[0];
  const prefix = bucketAndPrefix.slice(1).join("/");
  const fullObjectName = prefix ? `${prefix}/${objectName}` : objectName;

  const pdfBuffer = await renderInvoicePdf(invoice, items);
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(fullObjectName);
  await file.save(pdfBuffer, { contentType: "application/pdf" });

  const objectPath = `/objects/${objectName}`;
  await service.trySetObjectEntityAclPolicy(objectPath, { owner: invoice.userId, visibility: "private" });

  await db.update(invoicesTable).set({ pdfObjectPath: objectPath }).where(eq(invoicesTable.id, invoice.id));
  return objectPath;
}
