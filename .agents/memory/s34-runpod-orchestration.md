---
name: RunPod GPU Orchestration
description: Signalium-owns-RunPod-credentials pattern — budget enforcement, scoped worker tokens, monitor sweep.
---

## Credential boundary
Signalium holds the RunPod API key (vault-first via `resolveManagedConfig`, env fallback); the trainer never receives it. Instead the trainer is issued short-lived (60 min default) opaque bearer tokens scoped to one pod (`runpod_worker_credentials`, sha256-hashed at rest, same pattern as API keys). Rotation revokes-and-reissues; revocation is idempotent.

**Why:** the trainer must never hold standing RunPod credentials — mirrors the SSO/service-token least-privilege pattern.

## Budget enforcement must use server-trusted cost, never client input
`checkBudgetForLaunch` sums `lastReportedCostPerHrUsd ?? costPerHrUsd` across all pods in active-ish statuses (pending/provisioning/running/restarting) and rejects the launch/restart call (422) if it would exceed `maxHourlyCostUsd` or `maxActivePods`. Denials are still audit-logged (`runpod_pod.launch_denied_budget`) so refusals are visible, not silent.

**Why:** an early version accepted an optional `costPerHrUsd` on the launch request body and defaulted to 0 when omitted — trivially bypassable. Cost must be looked up server-side from an admin-configured GPU→price map (`runpod.gpu_pricing_json`) and the launch rejected outright if the GPU has no configured price, rather than treating unknown as free.

**How to apply:** any future GPU-cost-bearing action (e.g. a new "scale up" endpoint) must resolve its own trusted cost and call this same check before touching RunPod, not after — never accept cost as a caller-supplied field.

## Monitor sweep must reconcile local status to provider-reported status every poll
Polling active pods uses the same setInterval + `sweepInFlight` reentrancy guard as other health sweeps, at 60s cadence (tighter than a typical 5min sweep, since GPU cost accrues continuously). Each poll maps RunPod's `desiredStatus` onto the local status enum and persists it — local status set optimistically on launch/stop/restart is not trustworthy on its own and will drift if a poll is missed or the pod changes state outside our control. Cost accrual is computed from RunPod's own reported uptime seconds × latest reported cost/hr (not local elapsed wall-clock time, and not gated on stale local status) — accrual must be gated on the freshly-reconciled status, not the pre-poll one.

**Why:** an early version left local status untouched on poll and gated cost accrual on the stale local status, so the admin UI and cost figures both silently diverged from RunPod's actual state.

## Allowed-GPU config must be enforced, not just resolved
`runpod.allowed_gpus` is loaded via `getRunpodLaunchDefaults()` but enforcement is the caller's job — the launch route must explicitly check `gpuType` against the list and audit-log+422 on denial before doing anything else (before budget check, before calling RunPod). A config value that is read but never checked against provides no actual guardrail.

## RunPod GraphQL schema is best-effort
No live RunPod API key was available to verify field names against the real API; `client.ts` follows RunPod's public GraphQL docs as of build time (podFindAndDeployOnDemand/podStop/podResume/podTerminate/pod query, including `runtime.uptimeInSeconds`). If a future session sees actual RunPod API errors about unknown fields/mutations, treat this as the first place to check — the shapes were never verified against a live account.
