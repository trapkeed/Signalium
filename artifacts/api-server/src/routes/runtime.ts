import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, runtimeStatusTable, telemetryTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { RecordTelemetryBody, RecordHeartbeatBody } from "@workspace/api-zod";
import crypto from "crypto";

const router = Router();

router.get("/status", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [status] = await db.select().from(runtimeStatusTable).where(eq(runtimeStatusTable.userId, userId));

    if (!status) {
      return res.json({
        isConnected: false,
        lastHeartbeat: null,
        activeEas: 0,
        accountId: null,
        broker: null,
      });
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const isConnected = status.lastHeartbeat ? status.lastHeartbeat > tenMinutesAgo : false;

    return res.json({
      isConnected,
      lastHeartbeat: status.lastHeartbeat?.toISOString() ?? null,
      activeEas: status.activeEas,
      accountId: status.accountId,
      broker: status.broker,
    });
  } catch (err) {
    req.log.error(err, "Failed to get runtime status");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/telemetry", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const events = await db.select().from(telemetryTable)
      .where(eq(telemetryTable.userId, userId))
      .orderBy(desc(telemetryTable.createdAt))
      .limit(100);
    return res.json(events);
  } catch (err) {
    req.log.error(err, "Failed to list telemetry");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/telemetry", async (req, res) => {
  const parsed = RecordTelemetryBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [event] = await db.insert(telemetryTable).values({
      userId,
      eaId: parsed.data.eaId,
      eventType: parsed.data.eventType,
      payload: parsed.data.payload,
    }).returning();
    return res.status(201).json(event);
  } catch (err) {
    req.log.error(err, "Failed to record telemetry");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/heartbeat", async (req, res) => {
  const parsed = RecordHeartbeatBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const now = new Date();
    await db.insert(runtimeStatusTable)
      .values({
        id: crypto.randomUUID(),
        userId,
        lastHeartbeat: now,
        activeEas: parsed.data.activePositions ?? 0,
        accountId: parsed.data.accountId,
        broker: parsed.data.broker,
      })
      .onConflictDoUpdate({
        target: runtimeStatusTable.userId,
        set: {
          lastHeartbeat: now,
          activeEas: parsed.data.activePositions ?? 0,
          accountId: parsed.data.accountId,
          broker: parsed.data.broker,
        },
      });

    return res.json({ ok: true, timestamp: now.toISOString() });
  } catch (err) {
    req.log.error(err, "Failed to record heartbeat");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
