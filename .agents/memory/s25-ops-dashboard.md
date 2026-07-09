---
name: S25 Platform Operations Dashboard
description: Durable lessons from building the unified Operations Dashboard (User/EA/Autonomous Trading/Infrastructure/Alerts monitoring).
---

## "Report unconfigured, don't fake" extends to trial/exposure/queue metrics
No `trial` field exists on plans/subscriptions — trial-conversion is approximated via subscription lifecycle events (`SUBSCRIPTION_CREATED`→pending_payment as "started", `PAYMENT_CONFIRMED` as "converted"), explicitly labeled a proxy in the API response. Same pattern for "exposure by symbol/asset class" (no lot-size field exists — approximated as account-count holding a position, not notional) and for queue/cache/storage infra (report `configured: false` rather than fabricating numbers), and for "autonomous engine uptime" (approximated via % of `platformHealthSnapshotsTable.dbHealthy` samples in 24h).
**Why:** consistent with the existing Redis-not-configured pattern in `platformHealth.ts` — never fabricate a metric the schema can't actually support.

## API response-time has no APM — added a process-local ring buffer instead
There's no metrics/APM stack. `apiResponseTimeMiddleware` (in `apiResponseTime.ts`) records per-request duration into a fixed-size in-memory ring buffer, mounted early in `app.ts`'s middleware chain. Explicitly process-local (resets on restart, not shared across instances) — documented as such rather than pretending it's a real APM signal.

## orval codegen: rerun the looseObject sed fix on every regen
Every `orval` codegen run regenerates `zod.looseObject` calls for unconstrained (`additionalProperties: true`) OpenAPI schemas, which doesn't exist in Zod 3.x. Must re-run `sed -i 's/zod\.looseObject/zod.object/g' lib/api-zod/src/generated/api.ts` after every codegen, not just once — it's not a one-time fix, it's a post-codegen step.

## New alert-type enum values require both a db push and a lib/db rebuild
Adding values to a pgEnum in `lib/db/src/schema/*.ts` needs `pnpm --filter @workspace/db run push` (drizzle-kit push) AND `npx tsc -b` inside `lib/db` (composite project) to refresh `dist/*.d.ts` — otherwise downstream packages' `tsc --noEmit` won't see the new enum values even though the source changed.

## Nullable fields propagated from a real backend fix must update the OpenAPI contract too
When replacing a hardcoded placeholder (e.g. `uptime: 99.9`) with a real value that can be `null` (no data yet), update the OpenAPI schema's type (`["number","null"]`) and rerun codegen — otherwise the generated frontend type still claims non-null and silently drifts from the real response shape.
