---
name: S32 Clerk-to-custom-auth migration
description: Lessons from replacing Clerk with self-hosted email/password + Google OAuth auth in Signalium.
---

- Never return a full Drizzle user row to the client — `passwordHash` rides along silently. Strip it explicitly (e.g. a `toSafeUser()` helper) at every route that returns `{ user }`, not just the obvious ones (login AND /me both leaked it here).
- `drizzle-kit push`'s data-loss confirmation prompts (e.g. adding a UNIQUE constraint to a column with existing rows) require a real TTY and cannot be bypassed with `--force`, piped stdin, or CI flags in this environment. When push hangs on "Interactive prompts require a TTY", inspect the diff yourself and apply the additive DDL by hand via the SQL tool instead of fighting the prompt.
- When migrating off a third-party auth provider, grep for the provider's env var names across the whole backend (not just the auth routes) — required-env-var checks and secret-rotation tracking lists are easy to miss and will misreport the app as broken/overdue post-migration.
- Keep an app-generated user id as a plain `text` PK with an app-side `$defaultFn` (e.g. `randomUUID()`) rather than a DB-side default, so it can be minted before insert and no other table's FK/type needs to change.
