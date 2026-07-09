---
name: S33 Market Data Provider Abstraction
description: Adapter registry pattern for pluggable market-data providers, health sweep, and active-provider resolution — lessons on making the abstraction actually load-bearing.
---

- An adapter-interface + registry pattern (slug → adapter with isConfigured/checkHealth) lets new providers be added via registration only, no route/UI changes — but a registry is only as good as who reads it. Defining a `getActiveProvider(role)` resolver is not enough; find or add a real call site (an admin/status endpoint, a settings screen, anything outside the module itself) or the abstraction is dead code that reviewers will flag as unmet.
- When a task says "vault-first, env fallback," verify the shared config-resolution helper's fallback argument is actually passed for every managed key. Passing only the vault key silently disables the env fallback — a subtle regression when providers are configured via legacy env vars.
- A DB column that already exists but has zero readers anywhere (e.g. an admin-settable "pin" field) is a strong signal that a required "consumption point" is genuinely missing, not just hard to find — search before assuming it's someone else's job.
- Manual "check now" admin actions and periodic background sweeps should call one shared health-check function so both write identical status rows, rather than maintaining probe logic twice.
