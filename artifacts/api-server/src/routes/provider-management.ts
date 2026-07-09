/**
 * S18 — Extended data-provider management routes
 *
 * Provider credentials, capabilities, live status, and symbol mappings.
 * All routes are admin-only.
 *
 *   GET    /data-providers/admin/:id/credentials
 *   POST   /data-providers/admin/:id/credentials
 *   DELETE /data-providers/admin/:id/credentials/:credId
 *
 *   GET    /data-providers/admin/:id/capabilities
 *   PUT    /data-providers/admin/:id/capabilities/:type
 *   DELETE /data-providers/admin/:id/capabilities/:type
 *
 *   GET    /data-providers/admin/:id/status
 *   POST   /data-providers/admin/:id/status/check
 *
 *   GET    /data-providers/admin/:id/symbol-mappings
 *   POST   /data-providers/admin/:id/symbol-mappings
 *   DELETE /data-providers/admin/:id/symbol-mappings/:mappingId
 *
 *   PUT    /data-providers/admin/:id/priority
 */

import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db } from "@workspace/db";
import {
  dataProvidersTable,
  providerCredentialsTable,
  providerCapabilitiesTable,
  providerStatusTable,
  providerSymbolMappingsTable,
  symbolsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";
import { checkAndRecordProviderHealth } from "../lib/marketData/health";
import { getAdapterForSlug, listRegisteredAdapters } from "../lib/marketData/registry";

const router = Router();

const VALID_CAPABILITY_TYPES = ["live", "historical", "calendar", "news", "sentiment"] as const;

// ─── Credentials ─────────────────────────────────────────────────────────────

router.get("/admin/:id/credentials", requireAdmin, async (req, res) => {
  const providerId = Number(req.params.id);
  if (isNaN(providerId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const rows = await db
      .select({
        id: providerCredentialsTable.id,
        providerId: providerCredentialsTable.providerId,
        keyName: providerCredentialsTable.keyName,
        // Never expose the value — return a masked preview
        keyValueMasked: providerCredentialsTable.keyValue,
        description: providerCredentialsTable.description,
        isActive: providerCredentialsTable.isActive,
        createdAt: providerCredentialsTable.createdAt,
        rotatedAt: providerCredentialsTable.rotatedAt,
      })
      .from(providerCredentialsTable)
      .where(eq(providerCredentialsTable.providerId, providerId));

    // Mask the key value — show first 4 chars + ***
    return res.json(
      rows.map((r) => ({
        ...r,
        keyValueMasked: r.keyValueMasked
          ? r.keyValueMasked.slice(0, 4) + "***" + r.keyValueMasked.slice(-2)
          : "***",
      })),
    );
  } catch (err) {
    req.log.error(err, "Failed to list credentials");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/:id/credentials", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const providerId = Number(req.params.id);
  if (isNaN(providerId)) return res.status(400).json({ error: "Invalid id" });

  const { keyName, keyValue, description } = req.body as {
    keyName?: string;
    keyValue?: string;
    description?: string;
  };

  if (!keyName || !keyValue) {
    return res.status(400).json({ error: "'keyName' and 'keyValue' are required" });
  }

  try {
    const [row] = await db
      .insert(providerCredentialsTable)
      .values({
        providerId,
        keyName,
        keyValue,
        description: description ?? null,
        isActive: true,
      })
      .returning();

    await logAudit(userId!, "provider_credential.created", "data_provider", String(providerId), { keyName });
    // Return masked
    return res.status(201).json({
      ...row,
      keyValue: undefined,
      keyValueMasked: keyValue.slice(0, 4) + "***" + keyValue.slice(-2),
    });
  } catch (err) {
    req.log.error(err, "Failed to create credential");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/:id/credentials/:credId", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const providerId = Number(req.params.id);
  const credId = Number(req.params.credId);
  if (isNaN(providerId) || isNaN(credId)) return res.status(400).json({ error: "Invalid id" });

  const { keyValue, description, isActive } = req.body as {
    keyValue?: string;
    description?: string;
    isActive?: boolean;
  };

  try {
    const patch: Partial<typeof providerCredentialsTable.$inferInsert> = {};
    if (keyValue !== undefined) { patch.keyValue = keyValue; patch.rotatedAt = new Date(); }
    if (description !== undefined) patch.description = description;
    if (isActive !== undefined) patch.isActive = isActive;

    const [updated] = await db
      .update(providerCredentialsTable)
      .set(patch)
      .where(and(eq(providerCredentialsTable.id, credId), eq(providerCredentialsTable.providerId, providerId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });
    await logAudit(userId!, "provider_credential.updated", "data_provider", String(providerId), { credId, keyName: updated.keyName });

    return res.json({
      ...updated,
      keyValue: undefined,
      keyValueMasked: updated.keyValue.slice(0, 4) + "***" + updated.keyValue.slice(-2),
    });
  } catch (err) {
    req.log.error(err, "Failed to update credential");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/:id/credentials/:credId", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const providerId = Number(req.params.id);
  const credId = Number(req.params.credId);
  if (isNaN(providerId) || isNaN(credId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [deleted] = await db
      .delete(providerCredentialsTable)
      .where(and(eq(providerCredentialsTable.id, credId), eq(providerCredentialsTable.providerId, providerId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    await logAudit(userId!, "provider_credential.deleted", "data_provider", String(providerId), { credId });
    return res.json({ id: deleted.id });
  } catch (err) {
    req.log.error(err, "Failed to delete credential");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Capabilities ─────────────────────────────────────────────────────────────

router.get("/admin/:id/capabilities", requireAdmin, async (req, res) => {
  const providerId = Number(req.params.id);
  if (isNaN(providerId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const rows = await db
      .select()
      .from(providerCapabilitiesTable)
      .where(eq(providerCapabilitiesTable.providerId, providerId));
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list capabilities");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/:id/capabilities/:type", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const providerId = Number(req.params.id);
  const type = req.params.type;

  if (isNaN(providerId)) return res.status(400).json({ error: "Invalid id" });
  if (!VALID_CAPABILITY_TYPES.includes(type as (typeof VALID_CAPABILITY_TYPES)[number])) {
    return res.status(400).json({ error: `'type' must be one of: ${VALID_CAPABILITY_TYPES.join(", ")}` });
  }

  const { supportedTimeframes, maxHistoryDays, notes } = req.body as {
    supportedTimeframes?: string[];
    maxHistoryDays?: number;
    notes?: string;
  };

  try {
    const [row] = await db
      .insert(providerCapabilitiesTable)
      .values({
        providerId,
        capabilityType: type as (typeof VALID_CAPABILITY_TYPES)[number],
        supportedTimeframes: supportedTimeframes ?? null,
        maxHistoryDays: maxHistoryDays ?? null,
        notes: notes ?? null,
      })
      .onConflictDoUpdate({
        target: [providerCapabilitiesTable.providerId, providerCapabilitiesTable.capabilityType],
        set: {
          supportedTimeframes: supportedTimeframes ?? null,
          maxHistoryDays: maxHistoryDays ?? null,
          notes: notes ?? null,
        },
      })
      .returning();

    await logAudit(userId!, "provider_capability.upserted", "data_provider", String(providerId), { type });
    return res.json(row);
  } catch (err) {
    req.log.error(err, "Failed to upsert capability");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/:id/capabilities/:type", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const providerId = Number(req.params.id);
  const type = req.params.type;
  if (isNaN(providerId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [deleted] = await db
      .delete(providerCapabilitiesTable)
      .where(
        and(
          eq(providerCapabilitiesTable.providerId, providerId),
          eq(providerCapabilitiesTable.capabilityType, type as (typeof VALID_CAPABILITY_TYPES)[number]),
        ),
      )
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    await logAudit(userId!, "provider_capability.deleted", "data_provider", String(providerId), { type });
    return res.json({ id: deleted.id });
  } catch (err) {
    req.log.error(err, "Failed to delete capability");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Status ───────────────────────────────────────────────────────────────────

router.get("/admin/:id/status", requireAdmin, async (req, res) => {
  const providerId = Number(req.params.id);
  if (isNaN(providerId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [status] = await db
      .select()
      .from(providerStatusTable)
      .where(eq(providerStatusTable.providerId, providerId));
    return res.json(status ?? null);
  } catch (err) {
    req.log.error(err, "Failed to get provider status");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Manually trigger a connectivity check against the provider's API endpoint.
 * Records the result in provider_status.
 */
router.post("/admin/:id/status/check", requireAdmin, async (req, res) => {
  const providerId = Number(req.params.id);
  if (isNaN(providerId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [provider] = await db
      .select()
      .from(dataProvidersTable)
      .where(eq(dataProvidersTable.id, providerId));
    if (!provider) return res.status(404).json({ error: "Provider not found" });

    const statusRow = await checkAndRecordProviderHealth(provider);
    return res.json(statusRow);
  } catch (err) {
    req.log.error(err, "Failed to run connectivity check");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Adapter metadata for this provider slug (whether a real adapter is
 * registered and whether it currently has credentials configured). Lets the
 * admin UI show "not connected" for stub providers before any check runs.
 */
router.get("/admin/:id/adapter", requireAdmin, async (req, res) => {
  const providerId = Number(req.params.id);
  if (isNaN(providerId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [provider] = await db.select().from(dataProvidersTable).where(eq(dataProvidersTable.id, providerId));
    if (!provider) return res.status(404).json({ error: "Provider not found" });

    const adapter = getAdapterForSlug(provider.slug);
    if (!adapter) return res.json({ hasAdapter: false, isConfigured: false });

    return res.json({ hasAdapter: true, isConfigured: await adapter.isConfigured() });
  } catch (err) {
    req.log.error(err, "Failed to get adapter info");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** Lists every provider slug that has a real (or stub) adapter registered — for admin UI reference. */
router.get("/registered-adapters", requireAdmin, async (_req, res) => {
  return res.json(listRegisteredAdapters().map((a) => ({ slug: a.slug, name: a.name })));
});

// ─── Symbol mappings ──────────────────────────────────────────────────────────

router.get("/admin/:id/symbol-mappings", requireAdmin, async (req, res) => {
  const providerId = Number(req.params.id);
  if (isNaN(providerId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const rows = await db
      .select({
        id: providerSymbolMappingsTable.id,
        providerId: providerSymbolMappingsTable.providerId,
        providerSymbol: providerSymbolMappingsTable.providerSymbol,
        canonicalSymbolId: providerSymbolMappingsTable.canonicalSymbolId,
        canonicalSymbol: symbolsTable.canonicalSymbol,
        displayName: symbolsTable.displayName,
        isActive: providerSymbolMappingsTable.isActive,
        createdAt: providerSymbolMappingsTable.createdAt,
      })
      .from(providerSymbolMappingsTable)
      .innerJoin(symbolsTable, eq(providerSymbolMappingsTable.canonicalSymbolId, symbolsTable.id))
      .where(eq(providerSymbolMappingsTable.providerId, providerId));
    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to list symbol mappings");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/:id/symbol-mappings", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const providerId = Number(req.params.id);
  if (isNaN(providerId)) return res.status(400).json({ error: "Invalid id" });

  const { providerSymbol, canonicalSymbolId } = req.body as {
    providerSymbol?: string;
    canonicalSymbolId?: number;
  };

  if (!providerSymbol || canonicalSymbolId === undefined) {
    return res.status(400).json({ error: "'providerSymbol' and 'canonicalSymbolId' are required" });
  }

  try {
    const [row] = await db
      .insert(providerSymbolMappingsTable)
      .values({ providerId, providerSymbol, canonicalSymbolId, isActive: true })
      .onConflictDoUpdate({
        target: [providerSymbolMappingsTable.providerId, providerSymbolMappingsTable.providerSymbol],
        set: { canonicalSymbolId, isActive: true },
      })
      .returning();

    await logAudit(userId!, "provider_symbol_mapping.upserted", "data_provider", String(providerId), { providerSymbol, canonicalSymbolId });
    return res.status(201).json(row);
  } catch (err) {
    req.log.error(err, "Failed to create symbol mapping");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/:id/symbol-mappings/:mappingId", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const providerId = Number(req.params.id);
  const mappingId = Number(req.params.mappingId);
  if (isNaN(providerId) || isNaN(mappingId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [deleted] = await db
      .delete(providerSymbolMappingsTable)
      .where(
        and(
          eq(providerSymbolMappingsTable.id, mappingId),
          eq(providerSymbolMappingsTable.providerId, providerId),
        ),
      )
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    await logAudit(userId!, "provider_symbol_mapping.deleted", "data_provider", String(providerId), { mappingId });
    return res.json({ id: deleted.id });
  } catch (err) {
    req.log.error(err, "Failed to delete symbol mapping");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Priority ─────────────────────────────────────────────────────────────────

router.put("/admin/:id/priority", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { priority, fallbackForProviderId } = req.body as {
    priority?: number;
    fallbackForProviderId?: number | null;
  };

  try {
    const patch: Partial<typeof dataProvidersTable.$inferInsert> = {};
    if (priority !== undefined) patch.priority = priority;
    if ("fallbackForProviderId" in req.body) patch.fallbackForProviderId = fallbackForProviderId ?? null;

    const [updated] = await db
      .update(dataProvidersTable)
      .set(patch)
      .where(eq(dataProvidersTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });
    await logAudit(userId!, "data_provider.priority_updated", "data_provider", String(id), patch);
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to update provider priority");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
