# Signalium ↔ Signalium-Trainer Linkage

This file lists everything you need to configure to connect this platform
(Signalium, this repo) with the **signalium-trainer** service (inference
engine, Research Lab, RunPod GPU orchestration), plus every API call that
crosses the boundary between them. Keep this file up to date whenever a new
trainer-facing setting or endpoint is added — check
`artifacts/api-server/src/lib/settingsDefinitions.ts` for the current source
of truth on config keys.

## 1. What you need to fill in

All of these can be set either in **Admin → Managed Secrets / Secrets Vault**
(preferred — encrypted, rotatable, audited) or as process environment
variables on the server (fallback). Vault values always win if both are set.

| Vault key | Env var fallback | Required? | What it is |
| --- | --- | --- | --- |
| `trainer.url` | `QDE_TRAINER_URL` | Yes, to enable any trainer integration | Base URL of the running signalium-trainer service, e.g. `https://trainer.yourdomain.com`. If unset, all trainer/inference/Research Lab calls fail closed (they error out — they never silently mock data). |
| `trainer.api_key` | `QDE_TRAINER_API_KEY` | Optional | Legacy shared API key, sent additively alongside the signed SSO token. Only needed if the trainer build you're running still checks for one. |
| `trainer.timeout_ms` | — | Optional (has a default) | Request timeout for outbound calls to the trainer. |
| `trainer.retry_count` | — | Optional (has a default) | Retry attempts for outbound trainer calls. |
| `trainer.circuit_breaker_threshold` | — | Optional (has a default) | Consecutive failures before the platform stops calling the trainer for a cooldown period. |
| `trainer.circuit_breaker_reset_ms` | — | Optional (has a default) | Cooldown length before retrying after the circuit breaker opens. |
| — | `QDE_RESEARCH_LAB_URL` | Optional | Base URL for Research Lab endpoints specifically (experiments, training runs, shadow testing, genealogy, datasets). Falls back to `trainer.url` if unset, so in most setups you only need to set `trainer.url`. |
| — | `RUNPOD_API_KEY` | Only if the trainer's GPU pods are provisioned via RunPod | Main RunPod API key, used by this platform to spin up/tear down GPU training pods. The trainer never sees this key directly. |
| `runpod.endpoint_id` | — | Only if using RunPod | RunPod serverless endpoint id. |
| `runpod.gpu_template` | — | Only if using RunPod | Default GPU pod template id. |
| `runpod.volume_id` | — | Only if using RunPod | Default persistent/network volume id for model artifacts. |
| `sso.issuer` | `JWT_ISSUER` | Yes (has a working default of `signalium`) | Issuer name embedded in the signed service tokens the platform mints for the trainer to verify. |
| `sso.access_token_ttl_seconds` | `JWT_EXPIRATION` | Optional (has a default) | Lifetime of the short-lived service token used for platform → trainer calls. |
| `sso.refresh_token_ttl_days` | `JWT_REFRESH_EXPIRATION` | Optional (has a default) | Lifetime of refresh tokens for human admin sessions used with `/sso/token`. |

Where to set these in the app: **Admin → Secrets Vault** (add/edit any of the
`trainer.*`, `runpod.*`, `sso.*` keys) or **Admin → RunPod** for the RunPod-specific
fields. The **System Settings** admin page shows a "configured / not configured"
badge for every key above.

On the **trainer side** (signalium-trainer's own environment), you need the
mirror image of this:
- The trainer must be pointed at this platform's base URL so it can fetch
  `GET /sso/jwks` to verify tokens signed by Signalium.
- The trainer must be given the `X-Api-Key` value that this platform issues
  for it (see `Admin → API Keys`) so its calls to `/operational/*`,
  `/symbols/discovery`, and `/qde/telemetry` are accepted by `requireApiKeyAuth`.
- If EAs report telemetry directly through the trainer rather than through
  the platform, the trainer needs this platform's public API base URL, not
  the other way around — confirm with the trainer's own deployment docs
  which direction it proxies telemetry in your setup.

## 2. Outbound calls: Signalium (this platform) → Trainer

Base URL used for all of these: `trainer.url` (or `QDE_TRAINER_URL` /
`QDE_RESEARCH_LAB_URL` for the Research Lab-specific ones). Auth: `Authorization:
Bearer <signed SSO service token>`, audience `signalium-trainer`, plus
`trainer.api_key` header if configured. If the base URL isn't configured,
these calls throw/error instead of silently returning fake data.

| Trainer endpoint | Method | Called from | Purpose |
| --- | --- | --- | --- |
| `/health` | GET | `lib/qdeTrainer.ts` | Reachability/latency probe, used by health checks and the circuit breaker. |
| `/` | POST | `lib/qdeTrainer.ts` | Primary QDE decision/action request. |
| `/qde/inference` | POST | `lib/qdeTrainer.ts` (via routes `POST /qde/inference`) | Request a market direction/trading signal. |
| `/qde/review-position` | POST | `lib/qdeTrainer.ts` (via `POST /qde/review-position`) | Ask the trainer to assess a single open position. |
| `/qde/portfolio-review` | POST | `lib/qdeTrainer.ts` (via `POST /qde/portfolio-review`) | Batch review of an account's whole portfolio. |
| `/experiments` | GET/POST | `lib/researchLab.ts` | List / create Research Lab experiments. |
| `/training/runs` | GET/POST | `lib/researchLab.ts` | List / start model training runs. |
| `/shadow-testing/deployments` | POST | `lib/researchLab.ts` | Launch a shadow/canary model deployment for comparison. |
| `/deployment-candidates/:id/approve` | POST | `lib/researchLab.ts` (backing `routes/deployments.ts`) | Atomically activate a trained model candidate. |
| `/genealogy/tree` | GET | `lib/researchLab.ts` | Fetch model lineage/version history. |
| `/datasets` | GET | `lib/researchLab.ts` | Browse datasets available to the trainer. |
| `https://api.runpod.io/graphql` | POST | `lib/runpod/client.ts` | Provision/monitor GPU pods for training (uses `RUNPOD_API_KEY` directly, not the trainer's URL — RunPod is a separate third party). |

## 3. Inbound calls: Trainer → Signalium (this platform)

Base URL the trainer should call: this platform's own public URL (e.g. your
production domain or `$REPLIT_DEV_DOMAIN` in dev). Auth: `X-Api-Key` header
(via `requireApiKeyAuth`) issued from **Admin → API Keys**, except `/sso/jwks`
which is intentionally public.

| Platform endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/sso/jwks` | GET | None (public by design) | Trainer fetches Signalium's public signing keys to verify service tokens itself, without a shared secret. |
| `/sso/verify` | POST | None (token+audience in body) | Optional convenience endpoint if the trainer prefers a network call over local JWT verification. |
| `/operational/telemetry` | POST | API key | Ingest live account/EA telemetry snapshots. |
| `/operational/ticks` | POST | API key | Continuous per-symbol tick stream ingestion. |
| `/operational/heartbeat` | POST | API key | EA/runtime heartbeat ping. |
| `/operational/execution-quality` | POST | API key | Ingest trade execution quality metrics. |
| `/symbols/discovery` | POST | API key | Submit newly discovered symbol/broker mappings for admin review. |
| `/qde/telemetry` (legacy path referenced in EA builder docs) | POST | API key (`x-api-key` / `x-hardware-id` headers) | Legacy telemetry ingest path used by some EA builds; prefer `/operational/telemetry` going forward. |

## 4. Auth scheme summary

- **Platform → Trainer:** short-lived signed JWT (`ES256`), audience
  `signalium-trainer`, minted via `POST /sso/token` (human admin session) or
  `getServiceToken()` internally for machine-to-machine calls. The trainer
  verifies these against `GET /sso/jwks` — no shared secret needs to be
  copied anywhere.
- **Trainer → Platform:** `X-Api-Key` header, issued and revocable from
  **Admin → API Keys**, checked by `requireApiKeyAuth` on every inbound
  ingest route.
- **Platform → RunPod:** `RUNPOD_API_KEY` sent directly to
  `api.runpod.io/graphql`. The trainer itself never receives this key.

## 5. Quick verification checklist

1. Set `trainer.url` (Admin → Secrets Vault) and confirm **System Settings**
   shows it as "configured".
2. From the platform, hit the trainer's `/health` — the Ops/Platform Health
   admin page will show trainer reachability once this is set.
3. Issue an API key for the trainer (Admin → API Keys) and confirm the
   trainer's own config has it set for its outbound calls to
   `/operational/*` and `/symbols/discovery`.
4. Confirm the trainer can reach `GET /sso/jwks` on this platform's public
   URL — this is required before any signed token from this platform will
   verify on the trainer's side.
5. If using RunPod, set `RUNPOD_API_KEY` plus the `runpod.*` vault keys, then
   check **Admin → RunPod** for a successful connectivity test.
