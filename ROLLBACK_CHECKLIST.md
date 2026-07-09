# Rollback Checklist

Use when a release is misbehaving in production and needs to be reverted.

1. **Identify what changed** — check `/admin/deployments` (Service Versions tab) for the backend build history, and `/admin/governance` for any QDE model deployment activated around the same time.
2. **QDE model rollback** — if a model deployment is implicated, use the DB-authoritative rollback in `/admin/deployments`: it activates the previous version's row inside a single DB transaction (atomic — never leaves two "active" deployments), then triggers a warm-up health check before serving live traffic again.
3. **Backend code rollback** — use the Replit checkpoint history (via the diagnostics/rollback flow) to restore the previous working commit, or `git revert` the offending change if working from a git remote.
4. **Re-run the readiness smoke test** (`POST /api/ops-readiness/smoke-test`) immediately after rollback to confirm the previous version is healthy, and record the run (it's audit-logged automatically as `release.smoke_test_run`).
5. **Check the audit log** (`/admin/audit-log`) for the sequence of `release.smoke_test_run`, deployment activation, and any support-ticket escalations that were created because of the incident — this becomes the incident timeline.
6. **Notify affected users** if the incident caused visible downtime or data issues (see `/admin/announcements` for a platform-wide banner, or escalate the relevant support tickets).
7. **Do not delete the failed deployment's row** — DB-authoritative history must be preserved for post-incident review; mark it superseded/rolled-back instead of deleting.
8. **Write a short postmortem** (what broke, why the smoke test did or didn't catch it, what check to add) before the next release.
