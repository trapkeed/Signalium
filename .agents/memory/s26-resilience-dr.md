---
name: S26 Resilience, HA & Disaster Recovery
description: DB-backed queue instead of Redis, LISTEN/NOTIFY cross-instance broadcast, honest backup/secret-rotation patterns, and bugs to avoid when repeating this pattern.
---

## Architecture decisions
- No Redis/BullMQ was introduced for either the job queue or cross-instance pub/sub — both ride on the Postgres instance the app already depends on. Job queue: `job_queue` table + `SELECT ... FOR UPDATE SKIP LOCKED` claim. Cross-instance WS fan-out: LISTEN/NOTIFY on a shared channel, borrowing a dedicated client from the existing pool (`pool.connect()`) rather than adding a direct `pg` dependency.
- Circuit breaker (closed/open/half-open) was hand-written — no opossum/p-retry in this stack. Layered on top of an existing `retryWithBackoff` rather than replacing it: retry handles one call's transient failure, the breaker tracks failure rate over time for a dependency.
- Backups are a **complement** to Replit's built-in Postgres PITR, not a replacement: logical `pg_dump` → gzip → object storage with checksum validation, for portability/environment-recreation, not as the primary DR path.
- Secret rotation is a **tracking/reminder system**, not fake auto-rotation — only genuinely-rotatable secrets (e.g. an app-owned signing key) get real rotation; third-party keys (Clerk, session secret) just get a due-date + overdue alert.
- Config export/import is scoped to platform *configuration* only, and further split into two categories: natural-key tables (feature flags, symbol categories) are actually round-tripped by import; tables with cross-environment-unsafe numeric FKs (plans, symbols, brokers, data providers) are exported as reference-only and explicitly NOT imported — say so honestly in both the API shape and the docs rather than exporting them under the same key as if they were restorable.

## Bugs hit during this build (watch for these when repeating the pattern)
- **Object storage bucket-name parsing**: `PRIVATE_OBJECT_DIR` paths are `/<bucketName>/<...>` — bucket is the FIRST segment after the leading slash. `path.replace(/^\//, "").split("/")[0]`, not `[1]`. Getting this backwards silently misroutes every upload/download.
- **Retry backoff off-by-one**: if `attempts` is the 1-based count of attempts made so far, the Nth retry's delay is `schedule[attempts - 1]`, not `schedule[attempts]` — otherwise the first retry uses the second scheduled delay.
- **Never log the raw error object from a failed `execFile`/`exec` call that embeds a secret in the command string** (e.g. `pg_dump "$DATABASE_URL"`) — pass secrets via `env`, not string interpolation, and sanitize/redact connection-string patterns before logging or persisting any resulting error message.
- **Half-open circuit breaker needs an explicit single-probe guard** (e.g. a `probeInFlight` flag) — otherwise concurrent callers all observe `state === "open"` flip to allow-through at the same instant and all get let through, defeating the "one probe" semantics.
- **State-mutating "retry"/"requeue" actions must filter by current status in the WHERE clause** (e.g. `requeueJob` should only touch rows where `status = 'dead_letter'`), or an admin action can rewind an already-completed or in-flight row.
- **A pool client borrowed for a long-lived LISTEN must be explicitly `.release(err)`'d on its `error` event**, not just nulled out — otherwise repeated reconnect cycles slowly leak checked-out connections from the shared pool.
- Raw SQL via `db.execute<T>()` on the node-postgres driver returns `{ rows: [...] }` with snake_case column names; the generic `T` must extend `Record<string, unknown>` to satisfy drizzle's typing.
