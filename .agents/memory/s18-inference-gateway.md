---
name: S18 Inference Gateway Patterns
description: Lessons from building the QDE inference gateway, provider management routes, and admin UIs in S18.
---

## Generated hook calling convention (critical)
Orval generates hooks with positional parameters, not object destructuring.  
**Wrong:** `useListProviderCredentials({ id: providerId })`  
**Correct:** `useListProviderCredentials(providerId)`  
This applies to all generated hooks that take a path param as their first arg (`useGetProviderStatus`, `useListProviderCapabilities`, `useListProviderSymbolMappings`, etc.).  
**Why:** Passing `{ id }` silently produces `[object Object]` in the URL at runtime — the hook never errors at the TS level with `any` downstream types.

## Audit log action enum must be extended for new entity types
New admin mutations (credentials, capabilities, inference controls, etc.) use action strings that must be in the `auditLogTable`'s `action` enum in `lib/db/src/schema/audit-log.ts`. If they aren't, the build fails at the audit logger call sites.  
After adding enum values: run `pnpm run typecheck:libs` → `pnpm --filter @workspace/db run push` → `pnpm --filter @workspace/api-spec run codegen`.  
**Why:** The `AuditAction` type is derived directly from the Drizzle schema column enum, so type safety is end-to-end.

## Consecutive failures counter in status upsert
When using `onConflictDoUpdate` for a status-check upsert, incrementing a counter requires `sql\`${table.column} + 1\`` — not a raw number. Setting it to `1` on every failure resets rather than increments.  
**How to apply:** Import `sql` from `drizzle-orm` and use `sql\`${providerStatusTable.consecutiveFailures} + 1\`` in the failure branch of the conflict set. On success, always set to `0`.

## Gateway-only architecture reminder
Signalium contains no inference logic. All inference endpoints are proxies to `signalium-trainer` via `QDE_TRAINER_URL`. When trainer is offline, `simulateInferenceHeuristic` in `qdeTrainer.ts` returns a structurally-valid heuristic response. Never embed inference logic in this repo.

## InferenceControls singleton bootstrap
`inferenceControlsTable` uses `id = 'global'` as a single-row singleton. `getInferenceControls` upserts a default row on first read so the endpoint never returns null. Any admin mutation does `UPDATE WHERE id = 'global'` directly.
