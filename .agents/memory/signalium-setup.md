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

## Fresh-environment startup checklist
When artifacts fail to start after an environment reset/restore, check in this order: (1) `pnpm install` if `node_modules` is missing entirely, (2) Clerk keys via `checkClerkManagementStatus()`/`setupClerkWhitelabelAuth()` if `Missing Clerk Secret Key` or `Missing VITE_CLERK_PUBLISHABLE_KEY` errors appear, (3) `pnpm --filter @workspace/db run push` if API routes 500 with `relation "X" does not exist`.

**Why:** node_modules, secrets, and DB schema are all environment-local state that doesn't survive a fresh clone/restore, even though code and lockfile do.

## API key auth for EAs
Keys stored hashed (SHA-256), never in plaintext. Full key shown once on creation/rotation. `status` enum (active/revoked/expired/suspended) replaces old boolean `isActive`; expiry is checked lazily (flipped to `expired` on next verify/register call, not via a cron job). EA registration is a separate `ea_registrations` table keyed on (apiKeyId, hardwareId) so one key supports multiple terminals, VPS migration, and hardware replacement via upsert. `requireAdmin`/`isAdmin` middleware (checks `users.role === "admin"`) gates admin-only key actions (list-all, suspend, reactivate, security-report); revoke/rotate/registrations allow owner-or-admin.

**Why:** requirements explicitly called for multi-terminal support without re-issuing keys, and for admins to disable a compromised key without permanently revoking it (suspend vs revoke are distinct states).

## Orval + zod v3 vs empty-object OpenAPI schemas
An OpenAPI array item schema of bare `type: object` with no `properties` makes orval emit `zod.looseObject({})`, which doesn't exist in the installed zod v3 (only zod v4 has it) — causes a `tsc` error in generated code. Fix: always give object schemas explicit `properties`, even if minimal.

**Why:** hit this when adding a security-report endpoint with placeholder object items; codegen succeeded but `typecheck:libs` failed on the generated file.

## Express admin routes must precede `/:param` routes
In routers combining `/admin/...` static routes with `/:id/...` dynamic routes, declare all `/admin/*` routes before any `/:id/*` route, or Express matches "admin" as the `:id` param and the intended admin handler is never reached.

**Why:** hit this building `ea-builds.ts` — admin list/audit routes were silently shadowed by `/:buildId/download` etc. until reordered.

## Server-generated binary files bypass presigned upload flow
For files generated server-side (not user-uploaded), write/read directly via `objectStorageClient.bucket(...).file(...)` instead of the presigned-URL upload flow in `objectStorage.ts`/`objectAcl.ts` (that flow is for client-initiated uploads). Store the returned `/objects/<prefix>/<id>` path in the DB row and resolve it back to a GCS `File` handle for streaming downloads.

**Why:** used for EA build binaries (`eaBuilder.ts`) — the presigned-upload template assumes a browser-initiated PUT, which doesn't apply when the API server itself produces the file.

## api-server dev script is build+start, not a watcher
`pnpm --filter @workspace/api-server run dev` runs `build && start` once — it does NOT watch for file changes. Always call `restart_workflow` on "artifacts/api-server: API Server" after editing api-server source, before testing via curl/WS scripts, or you'll be testing stale code.

## ws library: attach listeners before any await in "connection" handler
`WebSocketServer` "connection" handlers that do async work (DB lookups, auth) before calling `ws.on("message", ...)` can silently drop the client's first frame if it arrives before the listener is attached — `EventEmitter.emit` with no listener just no-ops, frames aren't buffered. Fix: call `ws.pause()` as the very first line of the handler, do all async setup, attach all listeners, then `ws.resume()` at the end.

**Why:** hit this in the QDE EA gateway (`eaGateway.ts`) — a test client sending telemetry immediately on `open` got no response; the server's own auth/DB-insert awaits ran before `ws.on("message")` was registered, dropping the frame.

## Symbol normalization approach
Broker/EA symbol variants (e.g. `XAUUSD.a`, `XAUUSDm`, `GOLD`) are normalized via an in-memory Map cache (canonical symbols + aliases, lowercased keys) loaded from `symbols`/`symbol_aliases` tables, with iterative suffix-stripping (`.a`, `.pro`, `m`, `micro`, etc.) as a fallback before declaring a symbol unknown. Cache is invalidated on every admin write, not TTL-based.

**Why:** chosen over pure regex/fuzzy-matching so admins can add exact aliases (e.g. `WallStreet30` → `US30`) for cases the suffix heuristic can't infer, while keeping normalization fast (no DB hit per EA tick).

## Security-gate middleware must fail closed
Any middleware enforcing a security control (account lock, suspension, ban) that reads its decision from a DB lookup must treat a lookup failure as "deny", not "allow". A `catch { return next() }` pattern silently defeats the control during any DB hiccup.

**Why:** caught by architect review on the account-lock middleware — it originally failed open on DB errors, which would let a locked account back in whenever the lock-status query itself errored.

## Embedding full-page components inside tabs needs an `embedded` prop
When reusing an existing full-page component (own header/title + outer `flex-1 overflow-y-auto` wrapper) inside a tabbed/consolidated page, add an `embedded?: boolean` prop to that component that suppresses its own page header and outer scroll/padding wrapper, rather than just nesting it as-is. Nesting as-is causes duplicate headers and nested scroll containers.

**Why:** caught by architect review when consolidating Subscriptions/Payments/ApiKeys/EaBuilds into a single Account & Security page — each had its own `<h1>` + full-bleed wrapper meant for standalone routing.

## One-off scripts using object storage: externalize @google-cloud/storage when bundling
When esbuild-bundling a standalone script (e.g. a data migration) that imports `objectStorageClient`, bundling `@google-cloud/storage` causes `TypeError: Expected signal to be an instanceof AbortSignal` on upload — the bundle creates a duplicate `AbortSignal` realm that fails gaxios's `instanceof` check. Add `"@google-cloud/*"` to esbuild's `external` array (matching `build.mjs`'s existing list) and run the output with plain `node`.

**Why:** api-server's own `build.mjs` already externalizes this for the same reason; ad-hoc bundling commands must mirror that externals list or hit the same bug.
