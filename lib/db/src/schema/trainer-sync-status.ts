import { pgTable, serial, timestamp, boolean, integer, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Append-only log of trainer reachability probes (from the sync-status
 * dashboard and any future scheduled health check). Persisted so
 * "last successful check" / "last failed check" survive process restarts and
 * reflect real history rather than only the most recent request's outcome.
 * Never stores secret material — only reachability/latency/error metadata.
 */
export const trainerSyncProbesTable = pgTable("trainer_sync_probes", {
  id: serial("id").primaryKey(),
  reachable: boolean("reachable").notNull(),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTrainerSyncProbeSchema = createInsertSchema(trainerSyncProbesTable).omit({ id: true, checkedAt: true });
export type InsertTrainerSyncProbe = z.infer<typeof insertTrainerSyncProbeSchema>;
export type TrainerSyncProbe = typeof trainerSyncProbesTable.$inferSelect;
