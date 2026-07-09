---
name: Task #4 RunPod GPU Orchestration
description: Signalium-owns-RunPod-credentials pattern — budget enforcement, scoped worker tokens, monitor sweep.
---

## Credential boundary
Signalium holds the RunPod API key (vault-first via `resolveManagedConfig`, env fallback); the trainer never receives it. Instead the trainer is issued short-lived (60 min default) opaque bearer tokens scoped to one pod (`runpod_worker_credentials`, sha256-hashed at rest, same pattern as API keys). Rotation revokes-and-reissues; revocation is idempotent.

**Why:** the task explicitly requires the trainer never hold standing RunPod credentials — mirrors the SSO/service-token least-privilege pattern from S24C.

## Budget enforcement is a pre-launch gate, not a post-hoc alert
`checkBudgetForLaunch` sums `lastReportedCostPerHrUsd ?? costPerHrUsd` across all pods in active-ish statuses (pending/provisioning/running/restarting) and rejects the launch/restart call (422) if it would exceed `maxHourlyCostUsd` or `maxActivePods`. Denials are still audit-logged (`runpod_pod.launch_denied_budget`) so refusals are visible, not silent.

**How to apply:** any future GPU-cost-bearing action (e.g. a new "scale up" endpoint) must call this same check before touching RunPod, not after.

## Monitor sweep mirrors marketData/health.ts, not platformHealth.ts
Polling active pods for cost/utilization uses the same setInterval + `sweepInFlight` reentrancy guard as the market-data health sweep, at 60s cadence (tighter than the 5min market-data one, since GPU cost accrues continuously). Accrued cost is recomputed each poll from elapsed running time × latest reported cost/hr, not accumulated incrementally — avoids drift from missed polls.

## RunPod GraphQL schema is best-effort
No live RunPod API key was available to verify field names against the real API; `client.ts` follows RunPod's public GraphQL docs as of build time (podFindAndDeployOnDemand/podStop/podResume/podTerminate/pod query). If a future session sees actual RunPod API errors about unknown fields/mutations, treat this as the first place to check — the shapes were never verified against a live account.
