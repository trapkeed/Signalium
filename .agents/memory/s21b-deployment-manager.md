---
name: S21B Deployment Manager
description: Hot-swap deployment lifecycle patterns, safety invariants, and sharp edges from the QDE runtime deployment build.
---

## Activation must be atomic via DB transaction

Retire-others + activate-new must run inside a single `db.transaction()` call. Two separate updates are not safe — concurrent nodes can race and leave multiple active rows.

**Why:** Without a transaction, concurrent hot-swap calls (e.g. two API nodes polling at the same time) can each retire the other's active row and both activate their target, creating split-brain.

**How to apply:** Any code that flips a row from status X to status "active" must wrap retire+activate in `db.transaction(async (tx) => { ... })`.

## Rollback must query DB, not trust in-memory pointer

`_rollbackTo` always re-fetches the target row from the DB before acting. The in-memory `previousActive` is only a hint used to locate the DB row; the DB state is authoritative.

**Why:** In a multi-process deployment, the in-memory pointer is stale — another node may have already retired or re-activated the row. Using a stale pointer to roll back can activate a row that is no longer in the expected state.

**How to apply:** Pass the in-memory meta as a hint, query the DB to get the current row, then act on the DB row.

## Health flush: snapshot then reset synchronously before any await

`flushHealthSample()` copies all counters into local variables and calls `_resetHealthWindow()` synchronously before the first `await`. This prevents samples arriving during the DB write from being lost or double-counted.

**Why:** Node.js is single-threaded but `await` yields; any samples pushed to arrays between `await` calls after a reset are silently dropped. Snapshot first, reset immediately, then write.

## Warm-up is a strict gate (fail-closed by default)

Warm-up failure throws and triggers rollback. Set `QDE_ALLOW_WARMUP_FAIL=true` to bypass (fail-open mode for planned trainer restarts).

**Why:** Activating a version the trainer has not warmed means the first real inference will be cold and slow. The original code silently swallowed warm-up errors; this creates invisible performance regressions.

## recordError() must be called in every inference catch block

All five inference handlers (`/inference`, `/review-position`, `/manual-analysis`, `/portfolio-review`, `/reasoning`) must call `deploymentManager.recordError()` in their catch block so error rates in health snapshots are accurate.

**Why:** The health system computes error_rate = errors / calls. If errors are not counted, the rate is always 0 and health alerts never fire for trainer failures.

## DB composite project references require explicit build step

`lib/db` uses `composite: true` in its tsconfig. After adding new tables or columns to the schema, run `pnpm --filter @workspace/db exec tsc --build` before type-checking dependent packages. Without this the dependent packages see stale `.d.ts` files and report "no exported member" errors.

**How to apply:** Any schema change → `tsc --build` in `lib/db` → then check dependents.
