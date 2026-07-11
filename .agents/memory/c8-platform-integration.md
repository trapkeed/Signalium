---
name: C8 Platform Integration
description: EA/QDE deterministic protocol — new tables, sequence numbers, position sync, broker state, execution confirmations, retry sweep.
---

# C8 Platform Integration

## What was added
Four new tables in `lib/db/src/schema/qde.ts`:
- `open_positions` — individual positions keyed by (eaRegistrationId, brokerTicketId); upserted on sync; closed positions get closedAt set rather than deleted.
- `broker_tickets` — immutable audit log of ticket lifecycle events (opened/modified/closed).
- `execution_confirmations` — EA-reported broker execution results; one per trainerActionId (unique constraint); distinct from ack (received) vs confirm (executed).
- `broker_state` — live broker connection/account state; one row per eaRegistrationId (unique constraint, upserted).

`trainer_actions` got two new columns: `sequenceNum integer` (nullable, null on pre-C8 rows) and `confirmedAt timestamp`, and a new `confirmed` status in the status enum (now: queued → delivered → acknowledged → confirmed | failed).

## Key decisions

**Why sequence numbers are nullable:** Existing rows pre-C8 have no sequence number. New rows always get one via `nextSequenceNum()` in a transaction.

**How sequence numbers are assigned:** `lib/positionSync.ts::nextSequenceNum(tx, eaRegistrationId)` runs `SELECT COALESCE(MAX(sequence_num), 0) + 1 FROM trainer_actions WHERE ea_registration_id = $id` inside the existing insert transaction. Safe for the sequential-per-EA write pattern (one trainer decision per 30s telemetry tick).

**Shared sync helper:** `artifacts/api-server/src/lib/positionSync.ts` contains `syncPositions()`, `parsePositionList()`, `parseBrokerStatePayload()`, and `nextSequenceNum()`. Both the HTTP route and WS gateway import from here — never duplicate sync logic.

**Retry sweep:** `artifacts/api-server/src/lib/commandRetry.ts` — reentrancy-guarded, runs every 60s (wired in `index.ts`). TTL=2min, MAX_RETRIES=3; exhausted commands → `failed`. Calls `deliverAction()` after re-queuing for immediate online delivery.

**New audit action:** Added `"model_request.action_confirmed"` to the audit-log enum in `lib/db/src/schema/audit-log.ts`. Any new audit action must be added to that enum or TypeScript will reject `logAudit()` calls.

**flushQueuedActions ordering:** Updated to use `.orderBy(sequenceNum, createdAt)` so reconnect flush respects command order.

**deliverAction WS frame:** Now includes `sequenceNum` field so EAs receive it alongside the actionId.

## How to apply
- After any schema change: `pnpm --filter @workspace/db run push` then `pnpm run typecheck`.
- After adding new audit actions: add to the enum in `lib/db/src/schema/audit-log.ts` first or `logAudit()` calls will fail TS.
- Position sync idempotency: the unique index on (eaRegistrationId, brokerTicketId) handles concurrent upserts safely.
- Execution confirmations are idempotent: both the HTTP route and WS handler check for an existing row before inserting.
