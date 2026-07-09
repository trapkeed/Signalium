---
name: S23c Security Operations & Audit Logs
description: security_incidents dedup scoping, rate-tracking tradeoffs, and audit-log volume decisions for the security ops feature.
---

- `security_incidents` is deliberately separate from `operational_incidents` — the latter is manually admin-curated (BROKER/EA/SERVER/PAYMENT/MODEL/NETWORK), the former is detector-created (brute-force auth, invalid webhook signature, API/EA abuse, abnormal trading).
- `emitSecurityIncident`'s dedup matches on `type` + whichever of `userId`/`ipAddress`/`apiKeyId`/`scopeKey` the caller passes. **Any incident type not naturally scoped by those columns must pass an explicit `scopeKey`** (e.g. webhook provider name), or unrelated findings of that type will silently collapse into one open incident during the dedup window. Found and fixed during code review — the omission is easy to reintroduce when adding a new detector.
- Dedup is check-then-insert (not atomic) — same accepted tradeoff as S23b's platform-alert dedup and the in-memory rate counters in `rateTracking.ts`: acceptable for a single-instance deployment where the goal is "catch the spike", not exact-once counting.
- Audit-log coverage for high-frequency automated activity (EA telemetry, model/trainer decisions) intentionally logs only *consequential* events, not every tick: EA registration lifecycle (not every telemetry POST) and trainer actions where `action !== "HOLD"` (not every 30s decision). Full raw history already lives in `positionTelemetryTable`/`trainerActionsTable`; duplicating it into the audit log would drown genuinely actionable entries.
- `resolveApiKeyAuth` (shared by the HTTP fallback and the WS gateway) takes an optional `ipAddress` param specifically so both call sites feed the same brute-force/abuse rate tracking — don't add a new EA auth path without threading IP through it too.
