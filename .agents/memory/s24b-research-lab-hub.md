---
name: S24B Research Lab Integration Hub
description: Gateway/proxy pattern for exposing a separate trainer system's research/training/deployment APIs through the main app, without duplicating its business logic.
---

## Pure proxy client, no heuristic fallback
When a feature area has no legitimate local computation to substitute for a downstream service's data (e.g. training/validation/deployment internals owned by a separate trainer system), the client module must throw a distinguishable "unavailable" error rather than simulate data. This differs from other trainer-integration modules in this codebase (e.g. inference heuristics) where a documented local fallback is legitimate — heuristic fallback is only appropriate when the local computation is a real, defensible substitute, not just "something to show."

**Why:** Research/training/deployment data is high-stakes and easy to mistake for real if fabricated; a clean unavailable state is safer than a fake number.

**How to apply:** Wrap all downstream calls in a client module that normalizes network/timeout/non-2xx failures into one typed error class (e.g. `XUnavailableError`), and have routes convert that error into a 503 with a stable `{ error: "..._unavailable" }` shape the frontend can key off of (check `error.status === 503` from the generated API client, not string matching).

## Orval unconstrained-object schemas need `.looseObject` patched
Reusing the S19 fix: OpenAPI schemas with `additionalProperties: true` (used here for opaque proxied trainer payloads) make orval emit `z.looseObject`, which doesn't exist in this project's Zod 3.x. After every `pnpm run codegen` in `lib/api-spec`, run `sed -i 's/zod\.looseObject/zod.object/g' lib/api-zod/src/generated/api.ts`.

## Audit sensitive reads only on confirmed success
When a route both proxies a call and writes an audit log for viewing sensitive data, gate the audit write on the proxy call actually succeeding (not just "route was hit") — otherwise a downstream 503/unavailable response still produces a false "user accessed sensitive data" audit record. Have the proxy helper return a success boolean the route checks before calling `logAudit`.

## Orval-generated hooks need `as any` on `{ query: { refetchInterval } }`
Existing convention across this codebase's admin pages (qde.tsx, inference-gateway.tsx) casts the polling options object with `as any` because the generated `UseQueryOptions` type from orval doesn't structurally accept a partial object without `queryKey`. Follow the same pattern for any new generated hook usage with `refetchInterval`.
