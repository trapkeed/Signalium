---
name: S30 Launch Readiness and Go Live
description: Aggregated dependency readiness checks, computed-vs-stored onboarding checklist, support ticket assignment/escalation, and release/rollback docs.
---

Before building "launch readiness" work, audit first: most of production readiness, go-live flows, support tickets, and the launch dashboard were already implemented in earlier phases (S22–S29). Only build the specific gaps a targeted audit surfaces — don't re-scaffold what already exists.

## Aggregated dependency readiness check
A single endpoint that reports SMTP/payment-provider/trainer/research-lab/DB/env health should reuse each dependency's own non-mutating probe rather than inventing new ones:
- SMTP: `nodemailer.createTransport(...).verify()` authenticates without sending mail — the correct way to test SMTP credentials with zero side effects.
- Payment providers: reuse the existing `isConfigured()`/`connectivityNote()` pair each provider already implements (from earlier stripe/paypal/flutterwave/usdt work) instead of re-deriving config presence.
**Why:** avoids duplicating "is this thing configured" logic in two places that can drift, and guarantees the check never actually performs a side-effecting action (charge, email).

## Onboarding checklist: computed, not stored
Chose a checklist computed live from existing tables (subscriptions, api_keys, ea_builds, ea_registrations) over a new "onboarding progress" tracking table.
**Why:** a stored progress table can drift from reality (e.g. show "API key created" after the key was later revoked); computing it from the tables that already prove each step happened can never show a false "done", and needs no separate write path to keep in sync.
**How to apply:** the *dismiss* flag is the one piece of real state (a user choosing to hide the widget without finishing every step) — that's stored on `users.onboardingDismissedAt` and must be checked server-side (short-circuit the checklist response) rather than only hidden client-side, or the widget reappears every reload/session.

## Support ticket assignment must validate the target role
An "assign ticket to admin" endpoint that writes an arbitrary user-supplied ID into `assignedAdminId` without checking that ID belongs to an actual admin/staff account is a real authz gap the code-review architect caught immediately — always look up the target user and check `isStaffLevel(role)` (from `lib/roles.ts`) before persisting an assignment, reject with 400 otherwise, and still allow `null` to unassign.

## Admin PATCH endpoints need enum validation before DB write
Loosely-typed request bodies cast straight to the DB enum type (`status as never`) let invalid values fall through to a DB-level 500 instead of a deterministic 400. Validate against an explicit `as const` array of allowed values first.

## orval codegen looseObject fix recurs on every codegen run
`sed -i 's/zod\.looseObject(/zod.object(/g' lib/api-zod/src/generated/api.ts` must be re-run after every `pnpm run codegen` in `lib/api-spec` — the installed zod version doesn't have `looseObject`, and orval keeps emitting it. This was already known from S19/S25 but is worth re-flagging: forgetting it blocks `typecheck:libs` with dozens of `TS2339` errors.
