---
name: S29 Security Hardening and Production Lockdown
description: Admin idle-timeout fail-closed pattern, CORS allowlist fail-closed default, maker-checker escalation, EA request signing rollout, hidden-endpoint audit method.
---

- **Idle-timeout "delete on expiry" is a bypass.** If a middleware deletes the activity/session row once it detects staleness, the *next* request finds no row and is treated as brand new — one rejected request, then back in. Correct pattern: leave the stale row untouched (don't refresh `lastSeenAt`, don't delete it) so every subsequent request on that same session id keeps failing until a genuinely new session id appears (i.e. real re-auth). Applies to any "N minutes of inactivity locks you out" feature layered in-app on top of a longer-lived platform session (Clerk, etc).

- **Env-configured allowlists must fail closed, not open, when unset in production.** `ALLOWED_ORIGINS.length === 0 → allow all` silently defeats the lockdown if ops forgets to set the var. Throw at startup instead when `NODE_ENV === "production"` and the allowlist is empty.

- **Auditing for "hidden endpoints"**: grep each router file for its own auth middleware reference (`requireAdmin|requireStaff|getAuth|requireApiKeyAuth|clerkClient`) rather than assuming a global mount-point gate exists — this codebase applies auth per-router/per-route, not via a blanket wrapper in `routes/index.ts`. Found and fixed two real gaps this way: `smtp.ts` (zero auth on the whole router) and `eas.ts` (catalog mutation routes had no auth while GETs were intentionally public).

- **Backward-compatible security rollouts**: adding a required secret/signature to an existing credential (e.g. EA API key signing) should be opt-in per-row (nullable column, e.g. `signingSecret`) — old rows without it fall back to legacy behavior, new rows get it by default. Avoids breaking existing clients on rollout day.

- **Maker-checker via a single generic `admin_action_approvals` table** (actionType/targetId/payload/status) is enough to gate one high-risk action (e.g. role escalation to admin/super_admin) without a bespoke table per action. Key correctness points: block self-approval (`requestedBy !== approver`), consume (delete) the approval record once used so it can't be replayed for a later, different request.
