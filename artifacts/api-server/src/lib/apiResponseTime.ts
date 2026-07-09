/**
 * S25 — Lightweight in-memory API response-time tracker.
 *
 * There is no APM/metrics infra in this project (no Prometheus, no
 * StatsD) — rather than fake numbers, we record real response times for
 * every request into a capped ring buffer and expose simple rolling
 * aggregates (avg / p95 / sample count) for the Operations Dashboard's
 * infrastructure-monitoring section. Process-local only: on a multi-instance
 * deployment this reflects only the instance serving the dashboard request,
 * which is an acceptable approximation given there's a single API server.
 */
import type { NextFunction, Request, Response } from "express";

const MAX_SAMPLES = 2000;
const samples: number[] = [];
let writeIndex = 0;
let sampleCount = 0;

export function apiResponseTimeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    samples[writeIndex] = durationMs;
    writeIndex = (writeIndex + 1) % MAX_SAMPLES;
    sampleCount = Math.min(sampleCount + 1, MAX_SAMPLES);
  });
  next();
}

export function getApiResponseTimeStats(): { avgMs: number | null; p95Ms: number | null; sampleCount: number } {
  if (sampleCount === 0) return { avgMs: null, p95Ms: null, sampleCount: 0 };
  const active = samples.slice(0, sampleCount).sort((a, b) => a - b);
  const avgMs = active.reduce((sum, v) => sum + v, 0) / active.length;
  const p95Index = Math.min(active.length - 1, Math.floor(active.length * 0.95));
  return { avgMs, p95Ms: active[p95Index], sampleCount: active.length };
}
