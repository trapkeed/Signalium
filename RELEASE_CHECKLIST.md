# Release Checklist

Run before promoting any backend or frontend change to the production deployment.

1. **Typecheck everything that changed**
   - `pnpm run typecheck:libs` (root)
   - `pnpm --filter @workspace/api-server exec tsc --noEmit -p .`
   - `pnpm --filter @workspace/signalium exec tsc --noEmit -p .`
2. **Push any pending schema changes** — `pnpm --filter @workspace/db run push` (verify no destructive/data-loss prompts before accepting).
3. **Run the readiness smoke test** — `POST /api/ops-readiness/smoke-test` as an admin. Confirm `overall` is `ok` or an expected `unconfigured` (e.g. a payment provider intentionally not yet connected). Any `error` or unexpected `degraded` blocks the release.
4. **Check the ops dashboard** (`/admin/ops-dashboard`) for MRR, active subscriptions, EA/trainer fleet health, and infra health before and after deploy — a release should not visibly regress any of these.
5. **Check `/admin/deployments`** — confirm the new backend build was recorded as a service version (logged automatically on boot) and, if a QDE model deployment is also going out, that its integrity hash and rollback candidate are visible before activating.
6. **Restart the affected workflow(s)** and confirm clean startup logs — no unhandled errors, and the `Startup diagnostic` log lines show `required_env_vars: ok`.
7. **Spot-check auth-gated routes** return `401`/`403` when called unauthenticated/without the right role, and `200` with real data when called correctly.
8. **Get sign-off** before flipping any feature flag or activating a new QDE deployment — this is currently a direct admin action (see `governance.tsx`), not a formal multi-party approval gate.

If any step fails, do not proceed — fix forward or use the Rollback Checklist.
