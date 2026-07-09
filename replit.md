# Signalium

Signalium is a fintech trading platform: users subscribe to plans, run Expert Advisors (EAs) against their broker/MT5 accounts, and admins manage the full operation (users, billing, symbol normalization, brokers/data providers, feature flags, content, and support) from a dedicated admin panel.

## Run & Operate

- `pnpm --filter @workspace/signalium run dev` — run the web frontend
- `pnpm --filter @workspace/api-server run dev` — run the API server (builds + starts once; not a watcher — restart after backend changes)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec (run after editing `lib/api-spec/openapi.yaml`)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Auth: Replit-managed Clerk (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`) — auto-provisioned, dev/prod keys separate

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + wouter, Tailwind, shadcn/ui components
- Auth: Clerk (`@clerk/react`, `@clerk/express`)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec) — generated client hooks live in `lib/api-client-react`
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/signalium` — the web frontend (customer + admin panel)
- `artifacts/api-server` — Express API
- `lib/db/src/schema` — Drizzle schema, source of truth for the DB shape
- `lib/api-spec/openapi.yaml` — source of truth for the API contract; edit this then run codegen
- `artifacts/signalium/src/pages/admin` — all admin pages; nav grouping lives in `artifacts/signalium/src/components/layout.tsx` (`ADMIN_GROUPS`)
- `artifacts/signalium/src/hooks/use-feature-flags.ts` — feature flag gating hook (`useFeatureFlag(key)`)

## Architecture decisions

- **Dark-only theme (no light mode).** Signalium is a dark-themed trading terminal (charts, dense tables, status colors tuned for a dark background). A full light theme is a proportionally large design effort, so the app intentionally ships dark-only for now rather than a half-finished light mode. Revisit only if explicitly requested — see the open follow-up task for scoping a real light theme.
- **Feature flags are UI-only gates**, not an authorization layer. `GET /feature-flags` returns a `{key: boolean}` map for cheap client-side checks (`useFeatureFlag`); admins manage full flag rows via `/feature-flags/admin`. Gated routes/APIs are not currently blocked server-side if a user reaches them directly — this is a known gap, see the open follow-up task.
- **Symbol normalization** resolves broker/EA symbol variants via an in-memory cache of canonical symbols + aliases (optionally scoped to a broker), invalidated on every admin write rather than on a TTL.
- **Payment providers** are pluggable and DB-configured (`payment_providers` table stores type + JSON config) rather than hardcoded per provider in route code.

## Product

- Customers: subscribe to plans, connect EAs/MT5 accounts via API keys, view runtime/telemetry, manage billing, get support, refer other users (when the `referrals_enabled` feature flag is on).
- Admins: manage users/subscriptions/payments, the symbol registry (canonical symbols, aliases, brokers, data providers), feature flags, content (announcements/SEO/media/knowledge base), support/contact, and platform status — all from a grouped admin nav.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `api-server`'s dev script is `build && start`, not a file watcher — restart the workflow after backend source changes.
- After changing `lib/db` schema, run `pnpm --filter @workspace/db run push`, then regenerate the API client if the OpenAPI spec also changed.
- Frontend pages must import generated hooks from `@workspace/api-client-react`, not from the internal generated path.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
