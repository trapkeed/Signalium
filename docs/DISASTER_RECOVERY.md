# Signalium — Disaster Recovery & Resilience Runbook (S26)

This document covers backup/restore, recovery objectives, environment
recreation, deployment rollback, and the resilience infrastructure added in
S26 (Scalability, High Availability & Disaster Recovery). Admin/SuperAdmin
dashboard: `/admin/resilience`. API namespace: `/api/resilience/*`
(admin-gated). All of this is additive to the existing SSO/Ops/Security
dashboards from S24C/S25/S23c — see those for identity, platform-health, and
security-incident tooling.

## Recovery objectives

- **RPO (Recovery Point Objective): ~24 hours** for the logical `pg_dump`
  backups this system produces (daily schedule), and effectively **near-zero**
  for Replit's built-in point-in-time restore (continuous WAL-based, see
  below) — use PITR whenever the loss window matters more than portability.
- **RTO (Recovery Time Objective): under 1 hour** for a database restore
  (restore + verify), assuming the target infrastructure (compute) already
  exists. Full environment recreation (new Repl/deployment from scratch) is
  targeted at **under 4 hours**, dominated by manual secret re-entry and DNS
  if applicable.

## Two complementary backup mechanisms — use the right one

| | Replit managed Postgres PITR | Our logical backups (`pg_dump`) |
|---|---|---|
| What it is | Continuous point-in-time restore built into Replit's managed database | Daily `pg_dump -Fc` snapshot, gzip'd, uploaded to object storage, sha256-checksummed |
| Retention | 7 days (Core plan) / 28 days (Pro/Teams) | Configurable via `BACKUP_RETENTION_DAYS` (default 30d); always keeps at least the most recent backup even past expiry |
| Restore target | Same managed instance, any point in time within the window | Any Postgres instance — portable across environments |
| Use for | "Restore to 10 minutes ago", accidental data loss/corruption on the live DB | Environment recreation, compliance archive beyond the PITR window, exporting a known-good snapshot before a risky migration |
| How to restore | Replit workspace → Database pane → Restore. Beyond the retention window, contact Replit Support. | See "Restoring from a logical backup" below |

**Rule of thumb:** if you need "undo the last N minutes/hours on this exact
database", use PITR first — it's faster and lossless. Reach for our logical
backups when you're rebuilding on new infrastructure or need an artifact
older than the PITR window.

## Backups — day to day

- Scheduled automatically once every 24h (`startBackupScheduler` in
  `artifacts/api-server/src/index.ts`); can also be triggered on demand from
  `/admin/resilience` → "Run backup now".
  - Runs `pg_dump -Fc | gzip`, uploads to the app's private object storage
    bucket under `backups/db/`, records size + sha256 checksum in
    `backup_records`.
  - A failed backup raises a `backup_failure` platform alert (critical) —
    shows up in the existing Alerts dashboard, not just this one.
- **Validate** a backup periodically (dashboard button, or
  `POST /api/resilience/backups/:id/validate`) — this re-downloads the object
  and re-verifies its checksum, proving the artifact is actually restorable,
  not just that the upload call returned success at the time.
- **Retention**: backups past `BACKUP_RETENTION_DAYS` (default 30) are pruned
  automatically, except the single most recent backup is never pruned — there
  is always at least one recovery point available even if the schedule has
  been broken for a while.

### Restoring from a logical backup

The app deliberately never executes a restore against its own live database
automatically — restoring is a manual, deliberate operation. From
`/admin/resilience`, "Restore plan" on any backup gives the exact steps
(also available via `GET /api/resilience/backups/:id/restore-plan`):

1. Provision the target Postgres instance (new environment) or confirm you
   intend to restore over the **current** database (destructive — take a
   fresh backup first).
2. Download the dump from object storage.
3. `gunzip` it.
4. `pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" restore.dump`
5. Run `pnpm --filter @workspace/db run push` if the target schema predates
   the backup, to reconcile any drift.
6. Verify: spot-check row counts, then hit `GET /api/ready` against the
   restored database.

## Environment recreation

For rebuilding the app on a brand-new environment (e.g. disaster recovery to
a fresh Repl, or standing up a staging clone):

1. Fork/recreate the Repl, or provision a fresh Postgres + object storage
   bucket.
2. Re-enter secrets: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
   `VITE_CLERK_PUBLISHABLE_KEY`, `SESSION_SECRET`, plus any broker/data
   provider API credentials stored as env vars (see `/admin/resilience` →
   Secret Rotation for the tracked list). Object storage vars
   (`DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`,
   `PUBLIC_OBJECT_SEARCH_PATHS`) are (re)provisioned by the object storage
   setup flow, not restored from backup.
3. Restore the database — either from a logical backup (above) or, if
   recreating from the *same* managed instance's PITR, via the Database pane.
4. Import platform configuration (feature flags, symbol registry, plans,
   brokers, data providers) from a config export:
   `GET /api/resilience/config-export` (download from the dashboard) →
   `POST /api/resilience/config-import` on the new environment. This is
   idempotent (upserts by natural key) — safe to run more than once.
   Note: this covers *configuration*, not user/trading data — that comes
   from the database restore.
5. `pnpm install`, `pnpm --filter @workspace/db run push`, start the
   workflows, hit `/healthz` then `/ready` to confirm the new instance is
   live and DB-connected.

## Deployment rollback

Zero-downtime rolling deploys, health/readiness-gated traffic cutover, and
rollback are handled by Replit's platform deployment feature — **not**
custom application code. If a deployment misbehaves, use Replit's deployment
history / checkpoints to roll back to the previous known-good deployment.
`GET /healthz` (liveness) and `GET /ready` (readiness — verifies DB
connectivity) exist specifically so an orchestrator can gate traffic cutover
on real readiness rather than "the process started."

## Application scalability

- **Stateless auth**: the app already authenticates via Clerk JWTs with no
  server-side session store, so horizontal scaling requires no session
  externalization work — any instance can validate any request.
- **Distributed WebSockets**: `adminOpsGateway` and `eaGateway` each track
  connected clients in per-process memory (unavoidable for the socket
  objects themselves), but event *fan-out* now goes through Postgres
  LISTEN/NOTIFY (`lib/pgBroadcast.ts`) instead of relying on in-process state
  — an event produced on instance A reaches clients connected to instance B.
  No Redis was introduced; this reuses the database every instance already
  depends on. NOTIFY payloads are capped at ~7.8KB — fine for event
  notifications, not for bulk data.
- **Durable job queue**: `lib/jobQueue.ts` is a DB-backed queue
  (`job_queue` table) with priority ordering, exponential-backoff retry, and
  dead-letter after exhausted attempts. Multiple horizontally-scaled
  instances can run the dispatch loop concurrently — jobs are claimed with
  `SELECT ... FOR UPDATE SKIP LOCKED`, so instances never double-process the
  same job.

## API reliability

- **Retries with backoff**: `lib/retry.ts`'s `retryWithBackoff`, used for
  trainer calls and EA registration.
- **Circuit breakers**: `lib/circuitBreaker.ts` — generic breaker (closed →
  open → half-open) wrapping outbound dependency calls. The QDE trainer call
  path (`qdeTrainer.ts`) uses one with graceful degradation: when the
  breaker is open, it falls back to the local heuristic decision tree
  instead of throwing, so EAs still get *some* guidance while the ML
  service recovers. View live breaker state at `/admin/resilience`.
- **Timeouts**: `AbortSignal.timeout(...)` on outbound HTTP calls
  (`researchLab.ts`, `deploymentClient.ts`), plus the circuit breaker's own
  per-call timeout.

## EA resilience

- EA heartbeat state and reconnect detection already exist
  (`eaHeartbeatStatesTable`, S22A) and feed the `ea_offline` alert.
- Trade finalization and payment webhook processing are already idempotent
  via DB constraints/status transitions (`tradeLifecycle.ts`); trainer-action
  delivery is idempotent via `queued → delivered → acknowledged` status
  transitions in `eaGateway.ts`. There is no separate "submit an order"
  endpoint in this codebase — the EA executes locally based on delivered
  actions, so that status-transition boundary *is* the idempotency guarantee
  for action delivery.
- EA-side local buffering/offline queuing during a disconnect is implemented
  in the EA binary itself, which is out of this repo's scope.

## Security

- **Secret/key rotation**: `/admin/resilience` → Secret Rotation tracks a
  due-date per known secret and raises a `secret_rotation_overdue` alert
  through the existing alerting pipeline when overdue. Most secrets here
  (Clerk keys, session secret) can't be rotated via API — this is an honest
  tracking/reminder system, not fake automatic rotation. The one secret this
  app *can* rotate for real is the SSO signing key
  (`/admin/sso` → rotate; old keys stay verifiable until issued tokens
  expire) — its rotation event is recorded into the same tracking table.
- **Backup encryption**: object storage backups rely on the platform's
  storage-layer encryption at rest; access is scoped to this app's private
  bucket path, reachable only via the admin-gated API.
- **Audit log retention**: `lib/auditRetention.ts` prunes `audit_log` rows
  older than `AUDIT_LOG_RETENTION_DAYS` (default 730 days / 2 years) on a
  daily sweep. Check current volume/oldest entry at `/admin/resilience`.
