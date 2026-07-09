---
name: Trade Telemetry & Learning Loop
description: Durable lessons from building the trade telemetry, position intelligence, and learning-loop pipeline.
---

## R-multiple must be computed from price data, not position metrics
`buildTradeTimeline` must use `computeRMultiple(direction, entryPrice, exitPrice, stopLoss)`. `opp.currentPrice` holds the exit price after an EXITED transition. Position metrics MFE/MAE fields are dollar-denominated, not R-multiples — do not use them for rMultiple.
**Why:** mfeR/maeR are never populated; using them produces null for every trade's R calculation.

## Trade finalisation must use step-level idempotency, not coarse timeline-existence guard
Do NOT check "if trade_timeline exists → return". That guard permanently skips downstream stages (counterfactuals, failure records, learning candidates) if a prior partial run created the timeline but crashed before completing them.
**How to apply:** Each stage is individually idempotent — `onConflictDoNothing` on unique(opportunityId, scenarioType) for counterfactuals, unique(opportunityId, candidateType) for learning candidates, and existence-check guards in failure record + reasoning validation. Always attempt all stages on every call.

## finaliseExitedTrade split: throwing vs. safe
- `finaliseExitedTrade` — propagates errors; use from admin finalize endpoint for real HTTP 500.
- `finaliseExitedTradeSafe` — catches and logs; use for fire-and-forget paths (inline after state transitions).
**Why:** Original swallowed all errors, making the admin endpoint always return `{ok:true}` even on failure.

## Trainer sync cursor must only advance on confirmed trainer acknowledgement
`lastSyncAt` must NOT be updated when trainer returns non-2xx or is unreachable. If the cursor advances on failure, subsequent syncs query from the new timestamp and the failed batch is permanently lost.
**How to apply:** Set `trainerAcknowledged = true` only on HTTP 2xx. Mark candidates processed and update `lastSyncAt` only in the `trainerAcknowledged` branch. On error/offline, update only `lastSyncStatus`/`lastSyncMessage` — leave the cursor unchanged so the next retry resends.

## Trainer offline ≠ sync success
When `QDE_TRAINER_URL` is not set, the batch is staged but NOT delivered. Status is `"offline"`, not `"ok"`. Learning candidates must remain unprocessed; cursor must not advance.
**Why:** Treating offline as ok clears the learning queue without actual ingestion, causing irreversible data loss.

## Execution quality running averages must be null-aware
Each numeric field in the `onConflictDoUpdate` set block must check `exec.field != null` before including it in the running-average formula. Using `?? 0` introduces null samples as zeros and biases the aggregate.

## orval codegen generates z.looseObject for unconstrained object schemas
When OpenAPI schemas have `additionalProperties` unconstrained, orval generates `z.looseObject` which does not exist in Zod 3.x. After any codegen run: `sed -i 's/zod\.looseObject/zod.object/g' lib/api-zod/src/generated/api.ts`.
