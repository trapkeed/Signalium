---
name: Signalium project setup
description: Architecture decisions, auth quirks, and sharp edges for the Signalium customer platform.
---

## Clerk proxy URL
Only set `proxyUrl` on ClerkProvider in production (`import.meta.env.PROD`). In dev mode, passing a proxy URL causes `failed_to_load_clerk_js` because the dev Clerk instance doesn't support proxying. Pattern: `const clerkProxyUrl = isProduction ? ... : undefined`.

**Why:** Clerk proxy middleware comment says "Only active in production". Dev instances load JS from CDN directly.

## req.auth is not typed — use getAuth(req)
`req.auth?.userId` causes TS2339 in Express route handlers even with `@clerk/express` installed. Use `import { getAuth } from "@clerk/express"` and `const { userId } = getAuth(req)` instead.

**Why:** Clerk's type augmentation on Express Request doesn't always propagate to all route files unless the import is explicit.

## Express async handlers need explicit return
All async route handlers must use `return res.json(...)` and `return res.status(N).json(...)` on every code path. Handlers with `if (!x) return res.json(...)` followed by try/catch where the catch block does `res.json(...)` without `return` trigger TS7030 "not all code paths return a value".

## @clerk/themes must be installed separately
`import { dark } from "@clerk/themes"` fails unless `@clerk/themes` is explicitly added. It is NOT included in `@clerk/react`.

## publishableKeyFromHost is internal API
`publishableKeyFromHost` from `@clerk/react/internal` is non-public and should not be used. Use `import.meta.env.VITE_CLERK_PUBLISHABLE_KEY` directly.

## framer-motion Variants type
Inline variant objects with `ease: "easeOut"` fail TS — `ease` must be `Easing | Easing[]`, not `string`. Use cubic bezier array `[0.25, 0.46, 0.45, 0.94]` or import and annotate with `type Variants` from framer-motion.

## DB lib stale declarations
After changing schema in `lib/db`, run `pnpm run typecheck:libs` before checking API server — stale `.d.ts` files cause spurious "no exported member" errors.

## DB column type changes require table drop (if new)
Drizzle push refuses to ALTER column types (e.g., text enum → boolean). If the table is new/empty, drop it manually with `psql "$DATABASE_URL" -c "DROP TABLE IF EXISTS <name> CASCADE;"` then re-push.

**Why:** PostgreSQL can't ALTER a column type without an explicit USING clause; drizzle-kit doesn't generate one.

## Orval codegen regenerates index.ts with duplicates
Orval `mode: "split"` with `schemas: { path: "generated/types" }` regenerates `lib/api-zod/src/index.ts` with duplicate `export * from './generated/api'` lines AND a `export * from './generated/types'` that conflicts with same-named Zod schemas in `api.ts`. Fix: post-process the generated index.ts in the codegen script to strip the `./generated/types` re-export and deduplicate lines.

**How to apply:** The codegen script in `lib/api-spec/package.json` uses a node inline script to filter and deduplicate the generated index.ts after orval runs, before typecheck:libs.

## Frontend hook imports — use @workspace/api-client-react
All page files must import hooks from `@workspace/api-client-react`, NOT from `@/lib/api-client-react/generated/api`. The latter path causes TS2307 (module not found) because that path is not aliased in vite/tsconfig.

## Payment provider architecture
Pluggable design: `payment_providers` table stores type+config as JSON. Types: `usdt`, `card`, `bank_transfer`. Admin configures wallet/apiKey/etc per type in `config` JSON column. No provider code is hardcoded in routes — routes are generic and read provider config from DB. Adding a new provider = insert a row + update frontend `PROVIDER_ICONS/LABELS` maps.

## Payment flow
USDT: user picks plan → picks provider → API creates payment intent with reference → user sends crypto → submits tx hash → admin confirms via `/payments/:id/confirm` → subscription activated automatically. Card: same flow, `config.apiKey` holds provider credentials.

## API key auth for EAs
Keys stored hashed (SHA-256). Full key shown once on creation. EA runtime calls `POST /api/api-keys/verify` with `x-api-key` header. Route checks hash match + active subscription. Returns `{ ok, userId, keyId }`.
