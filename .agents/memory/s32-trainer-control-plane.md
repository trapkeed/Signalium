---
name: S32 Trainer Admin Control Plane
description: Admin control-plane pattern for gating trainer mutations, splitting RunPod-owned reads from trainer-proxied reads, and the orval codegen gotcha it re-surfaced.
---

Trainer control actions (start/stop training, create experiment, launch shadow test) are admin-gated and audit-logged on **both** success and failure paths, using a best-effort `.catch(() => {})` on the failure-path audit write so a broken audit log never masks the underlying error.

**Why:** Ops needs a trace of every attempted mutation against the trainer, not just the ones that succeeded — mirrors the pattern established for deployment activation/rollback.

**How to apply:** Any new trainer-mutating admin endpoint should log audit before returning, in both the try and catch branches, with the catch-branch audit write itself swallowed on failure.

Deploy/rollback were deliberately NOT duplicated in the new control-plane router — the UI links out to the existing `/admin/deployments` and `/admin/research-lab/deployment` pages instead of re-implementing activate/rollback.

**Why:** Those endpoints already wrap deploymentManager's atomic DB-transaction activate/rollback lifecycle (see S21B); duplicating it would risk two code paths mutating deployment state.

**How to apply:** When a new admin surface needs deploy/rollback, link to the existing page/action rather than adding a second endpoint that performs the same mutation.

RunPod-related inspection (jobs, GPU utilization, training costs) reads directly from `runpodPodsTable` rather than proxying through the trainer.

**Why:** Signalium (not the trainer) is authoritative for pod lifecycle/state (S21B/Task #4's domain) — proxying through the trainer would create a second, potentially stale source of truth for pod status.

**How to apply:** Any admin view that needs RunPod pod state should query `runpodPodsTable` directly, not add a trainer-side RunPod passthrough.

The zod `looseObject` orval-codegen issue (noted in S19/S25/S30) recurred again: after `orval` regenerates `lib/api-zod/src/generated/api.ts`, run `sed -i 's/zod\.looseObject/zod.object/g'` on that file before `pnpm -w run typecheck:libs`, or the build fails with `Property 'looseObject' does not exist`.

**Why:** The installed zod version doesn't support `.looseObject`, but orval's template still emits it — this is an environment/orval-version mismatch, not a one-off bug, so it will keep recurring on every codegen run until the orval template or zod version changes.

**How to apply:** Treat the sed fix as a mandatory step of the `pnpm --filter @workspace/api-spec codegen` workflow whenever new OpenAPI paths are added, not just when it happens to error.
