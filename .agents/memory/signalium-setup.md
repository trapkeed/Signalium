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
A `PaymentProvider` interface (`isConfigured`, `connectivityNote`, `createIntent`, `verifyWebhook`) is implemented once per concrete provider (USDT per network: trc20/erc20/bep20, plus stripe/paypal/flutterwave) and registered in a registry — routes/webhooks/lifecycle code only ever call the interface, never branch on provider-type strings. USDT providers read wallet/confirmation config from the DB `payment_providers.config` JSON; Stripe/PayPal/Flutterwave read credentials from env secrets (via the Replit connector, not DB config) and report `isConfigured()===false` + a human `connectivityNote()` until connected — never fake success. The provider list API exposes `connectable`/`limitation` fields so the admin UI can show this honestly.

## Payment flow and confirmation model
Payments move through `pending -> confirming -> confirmed|failed|expired` (+ `refunded`). USDT has no live blockchain monitoring in this environment (no node/paid indexer) — an admin must check a block explorer and report progress via `POST /payments/:id/confirmations`, which auto-confirms once the count reaches the network's required threshold. Stripe/PayPal/Flutterwave confirm via signed webhooks instead (dedup on `(provider, externalId)` in `webhook_events`). Every successful/failed payment event and invoice issuance is logged through the existing subscription event log (`PAYMENT_CONFIRMED`/`PAYMENT_FAILED`/`INVOICE_ISSUED`), and a PDF invoice is auto-generated on every subscription-affecting payment.

**Why:** the task explicitly required no fabricated on-chain data — USDT confirmation tracking is a manual admin action by design, not a bug to "fix" later without adding real blockchain infrastructure.

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

## Announcement fan-out is a one-time snapshot, not live
Admin announcements resolve their audience (all users vs plan tier, via active subscriptions joined to plans) once at publish time, writing one notification row per matching user. Users who join/upgrade after publish do not retroactively receive it.

**Why:** simpler mental model and matches "notification" semantics (a point-in-time event); live-updating would require re-computing audience membership continuously and handling partial delivery.

## Adding a NOT NULL UNIQUE column to a non-empty table via drizzle-kit
`drizzle-kit push` prompts interactively (TTY) when adding a NOT NULL/UNIQUE column to a table with existing rows, which fails in this non-interactive environment. Fix: manually backfill via raw SQL first (`ALTER TABLE ... ADD COLUMN` nullable, `UPDATE` to set values per row, then `ALTER COLUMN ... SET NOT NULL` and `ADD UNIQUE CONSTRAINT`), then run `drizzle-kit push` again — it will see the column already matches and skip the prompt.

**Why:** hit this adding `referral_code` to `users` (1 pre-existing row); the automated push has no way to answer the "how should existing rows be filled" prompt.

## Orval/zod v3: nullable object schemas
In `openapi.yaml`, do NOT declare a nullable object field as `type: ["object", "null"]` — orval+zod v3 doesn't support the array-of-types syntax and generated code fails to build. Use `type: object` with `nullable: true` and explicit `additionalProperties: true` instead.

**Why:** hit this adding the audit log `detail` field (arbitrary JSON, nullable); matches the pattern already used elsewhere in the spec for open-ended nullable objects.

## Referral attribution point
Referral attribution happens exactly once, at first-ever user-row provisioning (inside the existing sync-login lazy-provisioning path, since there's no signup webhook available). The referred code is captured client-side from a `?ref=` URL param into localStorage, sent on the next login call, and cleared after use. Self-referral is guarded explicitly even though structurally near-impossible; duplicate referral is prevented by a DB unique index on `referredUserId`, not application logic.

**Why:** provisioning-time is the only point the backend can be certain "this is a brand-new user" — attributing later would need extra state to detect first-vs-repeat login.

## Feature flag gating pattern
Feature flags are a simple `key -> boolean` map (no rollout %/targeting). Public `GET /feature-flags` returns `Record<string, boolean>` for cheap client-side gating (`useFeatureFlag(key)` hook, defaults to `false` while loading/missing so nothing is exposed prematurely); `/feature-flags/admin` returns full row objects for CRUD. Gating is UI-only (hide nav item/tab) — it does not block the underlying route/API, so it's a visibility toggle, not an authorization boundary.

**Why:** matches the spec's ask for a lightweight on/off switch admins can flip without a deploy, not a full experimentation platform; keeping the enforcement UI-only avoided touching every gated route's auth path for a first pass.

## Entitlement engine architecture
All access decisions (manual/autonomous mode, EA generation, API access, symbol/EA limits, research) route through a single `entitlementEngine.ts` module exposing `checkXAccess(userId)` functions returning `{allowed: true} | {allowed: false, code, message}` — never raw `plan.tier`/`status` string checks in routes. Lifecycle transitions (active→grace_period→expired) are computed lazily inside `resolveCurrentSubscription` on every read (idempotent, recursive), not via a cron job, mirroring the API-key-expiry pattern.

**Why:** spec required config-driven plan capabilities (no hardcoded tier names) and reuses the lazy-expiry pattern already proven for API keys, avoiding a background job.

**How to apply:** any new gated feature adds a `checkXAccess` function here and calls it from the route/gateway; never re-derive access from `subscription.status`/`plan.tier` inline elsewhere.

## Keep OpenAPI response schemas in sync with handwritten route handlers
Routes that return plain object literals (not validated by a zod response schema) can silently drift from the OpenAPI schema declared for that endpoint — nothing enforces the match at build time. When adding an endpoint like this, write the return shape and the OpenAPI schema together and diff them by eye before moving on.

**Why:** hit this building a new summary endpoint — the first implementation used different field names than the OpenAPI schema already written, which would have shipped a frontend type mismatch since nothing type-checks response bodies against the spec.

## Policy-mutation and access-control changes need explicit, not assumed, verification
Three related failure modes have recurred building the entitlement/billing system, each caught by code review rather than caught up front:
1. Platform-policy mutation routes (plan capabilities, feature flags, pricing) silently missing admin protection — never assume it carried over from a similar route; grep for the middleware explicitly.
2. Auth/entitlement rejections surfaced to external clients (HTTP body or WS error frame) need a stable machine-readable `code`, not just a message — a human-readable string alone can't be branched on programmatically.
3. Access checks tied to connection state (e.g. a WebSocket) must be re-evaluated on every message, not just at connect time — state (subscription tier, grace period, suspension) can change mid-connection, and a stale allow-decision from connect time will let a now-disallowed action through until reconnect.

**Why:** each of these is a case where the check existed *somewhere* in the codebase but wasn't wired to the actual enforcement boundary — the general lesson is to trace every access-control claim to the literal request path that needs it, not just the function that implements it.

**How to apply:** when adding or reviewing any access-control or admin-gated endpoint, explicitly trace: (a) is the middleware/check present on this exact route, (b) does the denial response carry a machine code, (c) if this is a persistent connection, is the check re-run per message/action rather than once at handshake.

## Grace period scope is asymmetric, not "degraded but working" uniformly
When a spec defines a grace period, capability-by-capability behavior can differ — don't default every check to "same as active" or "same as expired". In Signalium: manual dashboard access survives grace, but EA/API polling and autonomous mode are cut off immediately at grace start; only full account lockout waits for grace to lapse into EXPIRED. Read the spec's per-capability grace rules literally rather than inferring one from another.

## esbuild `external: ["@swc/*"]` breaks packages that `require()` `@swc/helpers` at runtime
Some transitive deps (e.g. `pdfkit` → `fontkit` → `brotli`) do a runtime `require("@swc/helpers/cjs/...")`. The api-server build externalizes `@swc/*` (to avoid bundling swc's own compiler internals), so esbuild leaves that require call untouched — but pnpm doesn't hoist `@swc/helpers` into the artifact's own `node_modules`, so Node's resolution from `dist/index.mjs` fails with `MODULE_NOT_FOUND` at startup (build succeeds, only fails at `pnpm run start`). Fix: add `@swc/helpers` as an explicit direct dependency of the artifact that hits this, so pnpm symlinks it locally.

**Why:** the externals list in `build.mjs` is shared boilerplate for many possible packages, not something to remove broadly — the real fix is making the missing package locally resolvable, not un-externalizing `@swc/*`.

## List endpoints returning provider/integration config must split public vs admin
Any "list configured providers/integrations" endpoint (payment providers, data providers, etc.) needs two routes from the start: an unauthenticated/low-privilege one returning only display fields (id/type/name/isActive/connectable), and a separate `requireAdmin` route returning the full row including `config`. Never let the public list handler serialize the raw config object, even behind a "config might not contain secrets" assumption — provider config columns are exactly where API keys/webhook secrets/wallet details end up. Admin UI forms should also only collect fields the provider actually reads from DB config; if a provider's real credentials come from env secrets (Stripe/PayPal-style), don't add form inputs for them at all — it just risks secrets landing in the DB for no functional benefit.

**Why:** caught by code review on the payments provider list endpoint, which was unauthenticated and returned full `config` (live API keys/webhook secrets) to anyone; the fix mirrors an existing public/admin split already used for data providers.

## Multi-step payment/subscription mutations must be one DB transaction
Any function that flips a payment/record status to a terminal state AND then does dependent writes (subscription upsert, event-log rows, invoice creation) must wrap the whole thing in `db.transaction(async (tx) => {...})`, passing `tx` through to every helper (event logger, invoice creator) instead of the module-level `db`. A leading `if (status === "confirmed") return` guard is only a valid idempotency/dedup check if a prior failed attempt is guaranteed to have rolled back everything — otherwise a mid-function crash leaves the status flipped but downstream writes (subscription, invoice) permanently missing, with the guard now blocking all retries.

**Why:** caught by code review on `applySuccessfulPayment` — it set payment status to "confirmed" as the very first write, then did subscription/invoice writes after, non-transactionally; any failure between those steps produced a payment marked confirmed with no subscription or invoice, and the status guard prevented any repair on retry.

## Webhook/event dedup via unique-constraint insert must check the DB error code, and must be retryable
When using "try insert into a uniquely-constrained table, catch = already processed" as a dedup pattern: (1) the catch block must check for the specific error (Postgres unique-violation code `23505` on the `pg` driver, `err.code`) before treating it as "already seen" — a bare `catch { dedupInserted = false }` silently reclassifies any DB error as a successful dedup and swallows real failures as false 200s; (2) a conflict must not always short-circuit as "deduped" — if the existing row's status shows the prior attempt never completed successfully (e.g. an explicit "failed" status set by the processing code's own catch block), atomically reclaim it via `UPDATE ... WHERE status = 'failed' RETURNING *` and reprocess, or a single transient failure permanently strands the event. Only reclaim on the explicit terminal-failure status, not on an in-progress status (e.g. "received") — that status is ambiguous between "actively being processed by a concurrent request right now" and "orphaned by a crash", and reprocessing it risks double-applying the event.

**Why:** caught by code review on the payment webhook handler's dedup insert into `webhook_events`, first for the error-code check, then again for the fact that a "failed" row could never be retried, permanently stranding a payment as unconfirmed after any transient error.

## Failure events can predate the entity they'd normally attach to
When logging a "this action failed" event into an FK-linked event log (e.g. a payment failure logged against a subscription), don't assume the FK target already exists — a first-ever attempt can fail before the entity it would have created is ever inserted. Make the FK column nullable and resolve a best-effort existing entity at log time (e.g. look up the user's current subscription by status) rather than skipping the log entry when none is found.

**Why:** caught by code review — `applyFailedPayment` only logged `PAYMENT_FAILED` when the payment row already had a `subscriptionId`, which is only ever set after a *successful* confirmation, so the most common failure case (a user's very first payment attempt failing) silently produced no audit trail at all.

## Idempotent add-to-set endpoints must check for duplicates before limit enforcement
For "add item to user's set" routes (e.g. POST /symbols/user), always check whether the (userId, itemId) pair already exists BEFORE running the plan-limit check. If it already exists, return 200 with the existing row — never 403. Running the limit check first causes the endpoint to 403 on idempotent re-adds when the user is already at cap, which is both wrong and a bad UX.

**Why:** caught by architect review on POST /symbols/user — the original order was: verify symbol exists → check limit → insert with onConflictDoNothing. A user at max who re-clicks a symbol they already monitor got SYMBOL_LIMIT_REACHED instead of idempotent success.

**How to apply:** query for the existing row first; return it immediately if found; only then enforce the limit and insert.

## Trading control plane: new tables and route layout
`user_trading_settings` (PK: userId, columns: tradingMode manual/autonomous, riskMode manual/qde, updatedAt) and `user_symbols` (userId + symbolId FK, unique constraint) live in `lib/db/src/schema/trading.ts`. Route for trading settings is `artifacts/api-server/src/routes/trading-settings.ts`, mounted at `/trading-settings`. User symbol selection endpoints are in `artifacts/api-server/src/routes/symbols.ts` at `/symbols/user`. `checkUserSymbolLimit` in entitlementEngine counts rows in `user_symbols` (not telemetry) — separate from the older `checkSymbolLimit` which was telemetry-derived.

**Why:** keeping user-declared intent (what symbols to monitor) separate from telemetry-derived data (what symbols have actually been traded) makes each check precise for its use case.

## Admin nav grouping
Admin sidebar nav is organized into named groups (`ADMIN_GROUPS`: Overview / Accounts & Billing / Trading Infrastructure / Content & Growth / Support & Comms / System) rather than one flat list, each rendered as its own `NavSection`. Feature-flagged nav items are filtered out of their group client-side before rendering (empty groups are dropped).

**Why:** flat admin list had grown past a dozen items across unrelated domains (billing, symbols, content, support); grouping keeps the pattern extensible as new admin pages are added.

## Clerk can silently be unconfigured despite dependent code existing
`checkClerkManagementStatus()` returning `not_configured` (missing `CLERK_SECRET_KEY`/`CLERK_PUBLISHABLE_KEY`/`VITE_CLERK_PUBLISHABLE_KEY`) can coexist with a codebase that fully depends on Clerk — don't assume auth is wired up just because the code references it. `setupClerkWhitelabelAuth()` provisions a fresh managed instance and sets all three secrets.

**Why:** hit this when admin-panel/auth features appeared broken for no obvious reason; the actual root cause was Clerk never having been provisioned in this environment at all.

## Codegen zod.looseObject sed target correction
The prior memory note said the sed fix targets `z.looseObject(` — the generated code actually emits `zod.looseObject(`. Sed must target `zod\.looseObject(`, not `z\.looseObject(`.

## Admin-only endpoints not in the OpenAPI spec use raw fetch, not generated hooks
Endpoints intentionally excluded from codegen (e.g. an encrypted secrets vault) are called from the frontend via `fetch(`${BASE_URL}api/...`, { credentials: "include" })` rather than `@workspace/api-client-react` hooks — matches the existing invoice-download pattern in admin/payments.tsx.

## Beginner VPS deployment guide exists
`DEPLOYMENT_GUIDE.md` at repo root walks through a non-Replit VPS deployment (Ubuntu + Nginx + PM2 + Let's Encrypt), listing every `process.env.*`/`import.meta.env.*` value the app actually reads. Keep it in sync if new required env vars are added.
