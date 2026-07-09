---
name: S33 Market Data Provider Abstraction
description: Adapter registry pattern for pluggable market-data providers (OANDA/Tiingo real, others stubbed), health sweep, and active-provider resolution.
---

- Provider-specific fetch/health logic lives behind a small `MarketDataAdapter` interface (slug/name/isConfigured/checkHealth), registered in one place (`registry.ts`). Adding a real provider later means writing an adapter and swapping it in — no route or UI changes.
- Two vault-backed real adapters (OANDA, Tiingo) resolve keys via `resolveManagedConfig` (vault-first/env-fallback) — never read from the generic plaintext `provider_credentials` table, which stays reserved for ad-hoc/manual provider config in the admin UI.
- The manual "check connectivity" admin route and the periodic background sweep share one function (`checkAndRecordProviderHealth`) so both paths write identical `provider_status` rows — avoid duplicating probe logic across a route handler and a sweep like the old code did.
- `inference_controls.liveProviderId` was already a DB column with no reader anywhere — it's an admin-settable pin with zero consumption logic. The single `getActiveProvider(role)` abstraction function is the reader: pin takes priority for "live", otherwise resolves highest-priority active provider with a matching `provider_capabilities` row.
- Seeding: only insert `data_providers` rows if missing (idempotent, keyed by slug), so re-running startup never duplicates or resets admin-edited priority/isActive.
