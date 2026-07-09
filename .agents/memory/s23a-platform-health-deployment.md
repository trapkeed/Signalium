---
name: S23a Platform Health & Deployment Tracking
description: System health monitoring, service version tracking, and QDE runtime health patterns added in S23a — read before extending alerting (S23b) or the realtime dashboard (S23d) on top of this data.
---

- Redis/BullMQ/queue infra does not exist anywhere in this repo (confirmed by full-repo search). Health/metrics code must report Redis as `configured: false` rather than fake a value — do not introduce Redis as infra just to fill a metrics field.
- System health snapshots (`platformHealthSnapshotsTable`) and QDE deployment health (`qdeDeploymentHealthTable`) are separate concerns: the former is process/OS-level (CPU/mem/event-loop/DB latency/WS conns), the latter is model-inference-level (latency percentiles/error rate/confidence buckets). Don't conflate them when adding new metrics — pick the table that matches the metric's layer.
- QDE runtime health (trade generation frequency, acceptance rate, avg confidence, avg holding duration, active trader counts) is computed **live** via SQL aggregation over `opportunitiesTable`/`tradeTimelineTable`/`userTradingSettingsTable` on each request rather than persisted to a snapshot table — cheap enough to not need caching, and avoids yet another table. Follow this pattern for similar derived/read-mostly ops metrics unless there's a proven need to persist history.
- Service version tracking (`serviceDeploymentsTable`, service enum: frontend/backend/trainer) is intentionally separate from `qdeDeploymentsTable` (which tracks the QDE *model* deployment lifecycle) — don't merge them, they have different lifecycles and one is display-only history (no activate/rollback actions).
- Interval-based background samplers (health snapshot capture, deployment polling) need a reentrancy guard (in-flight boolean) since a slow probe (e.g. DB ping) can outlast the interval and cause overlapping runs — see `platformHealth.ts`'s `captureInFlight` guard.
