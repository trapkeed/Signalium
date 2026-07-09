---
name: S27 Deployment Governance Visibility
description: Tiered read-only governance summary (SuperAdmin/Admin full, Founder strategic, else none) built on top of S21B deployments + S24B research-lab data — allowlisting and role-assumption pitfalls to avoid when repeating this pattern.
---

## Pattern
- A "governance visibility" surface (a condensed, cross-cutting read-only summary for institutional/strategic audiences) should live in its own lib+route pair, separate from the detailed admin surfaces it summarizes (e.g. deployments.ts, research-lab.ts) — it aggregates from them, it does not replace or re-gate them.
- When one surface needs to serve two visibility tiers, define both tiers' output as the return of a single builder function keyed by tier, not two near-duplicate route handlers — keeps the allowlist logic in one place.

## Bugs/pitfalls hit (and their fixes) in this build
- **Strict-allowlist selects must be enforced at the DB-query level, not just in a post-filter for the "reduced" tier.** Initially only the strategic (Founder) tier stripped internal fields (failureReason, feature-version, freeform event messages) while the "full" tier's `db.select()` still pulled them in — meaning any future refactor that forgot to re-strip would leak them to Admin/SuperAdmin too. Fix: the `select({...})` column list itself is the allowlist, shared by both tiers; there is no wider row to accidentally forward.
- **Tier/permission resolution must go through the effective-roles resolver, not the raw legacy `users.role` column**, whenever the system supports role assumption (a SuperAdmin temporarily "acting as" another role to preview their view). Checking the legacy role directly for a coarse "full access" gate silently ignores an active assumption and always grants the actor their permanent tier instead of the one they're supposed to be scoped to while assuming another role.
- **Never collapse distinct HTTP failure modes (401 unauthenticated, 403 forbidden, 503 upstream-unavailable) into one generic "restricted" UI message.** A session-expired 401 and a genuine 403 authorization denial need different user-facing copy and different remediation (sign in again vs. this data isn't for your role).
- Extracting fields from an externally-owned, loosely-typed upstream record (this project's Research Lab trainer proxy) should use a small `pickField(record, [...keyNameCandidates])` helper with graceful `null` fallback — never assume a specific key name is stable, and never forward the raw record to the client just because you needed one or two fields off it.
