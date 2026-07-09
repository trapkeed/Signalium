---
name: S22A Operational Infrastructure
description: EA telemetry, heartbeats, execution quality, risk alerts, incident management, ops dashboard — sharp edges and design decisions.
---

## Heartbeat identity must be (userId, eaInstanceId)
The heartbeat state table has a composite unique on (userId, eaInstanceId), NOT a global unique on eaInstanceId alone. All WHERE clauses in the heartbeat route use `and(eq(...userId, userId), eq(...eaInstanceId, eaInstanceId))` — never just eaInstanceId. A global unique would allow cross-tenant collisions if two users generate the same instance ID.

**Why:** Security — a valid API-key client could mutate another tenant's heartbeat row if keyed only by eaInstanceId.

**How to apply:** Any new query or update on eaHeartbeatStatesTable must include userId in the WHERE predicate.

## Risk-alert dedup uses code-level guard, not DB constraint
`ea_risk_alerts` has no unique constraint. `.onConflictDoNothing()` was removed because it silently fails without a matching constraint. The dedup guard is a `hasOpenAlert(userId, eaInstanceId, alertType)` helper that checks for an existing unacknowledged alert of the same type today before inserting.

**Why:** No unique constraint was added because the dedup window is "same type + same user/instance + today" which is hard to express as a simple unique index (nullable eaInstanceId, date-scoped).

**How to apply:** Any new risk-alert ingest path must call the guard before inserting.

## Dashboard fleet state math
The `online` count only includes instances with `state === "ONLINE"` AND `lastSeenAt` within the last 60 s. DEGRADED (60–120 s), UNAUTHORIZED, and OUTDATED are counted separately. `offline` = no lastSeenAt OR lastSeenAt older than 120 s OR explicit OFFLINE state.

**Why:** The reviewer found that the original code counted UNAUTHORIZED/OUTDATED as "online" when they are within the timestamp threshold — incorrectly inflating the online count.

## Execution-quality aggregation is select-then-insert/update
The route does a SELECT first; if no row found for (userId, periodDate, eaInstanceId), INSERTs; otherwise UPDATEs by id. This is race-prone for concurrent ingests but acceptable since an EA sends one quality ping at a time. No unique DB constraint was added due to nullable eaInstanceId complexity.

## requireStaff is in requireAdmin.ts
`requireStaff` is exported from `../middlewares/requireAdmin` (not a separate file). Import: `import { requireStaff } from "../middlewares/requireAdmin"`.

## validateApiKey → requireApiKeyAuth
The API-key middleware is `requireApiKeyAuth` (in `requireApiKeyAuth.ts`). It sets `req.eaAuth: { userId, apiKeyId, eaRegistrationId }`. Use `req.eaAuth!.userId` to get the authenticated user.

## heartbeat state comparison requires cast
Drizzle infers enum column values as literal types. Comparing `state === "OFFLINE"` (where `state` has a union enum type) triggers TS2367 "comparison unintentional" in strict mode. Workaround: `(state as string) === "OFFLINE"`.

## Telemetry ingest eaInstanceId local alias
In the telemetry ingest handler, `eaInstanceId` is re-aliased from `row.eaInstanceId ?? null` AFTER the insert `.returning()`. Use this alias for risk-alert dedup calls to avoid re-reading `body.eaInstanceId` which could be undefined.
