---
name: SSO issuer/TTL vault config
description: How SSO issuer and token TTLs became admin-configurable via the generic secrets vault
---

Signalium's JWT SSO (`artifacts/api-server/src/lib/sso.ts`) already had DB-persisted rotatable ES256 signing keys, JWKS, mandatory audience checks, and a rotate endpoint with audit logging before this change — only the issuer/TTL *config* was hardcoded.

Resolved `sso.issuer`, `sso.access_token_ttl_seconds`, `sso.refresh_token_ttl_days` through `resolveManagedConfig` (vault-first, env fallback: `JWT_ISSUER`/`JWT_EXPIRATION`/`JWT_REFRESH_EXPIRATION`), added an async `getSsoKeyStatus()` returning key rotation history + resolved config (never private key material), and exposed it at `GET /sso/key-status` (super_admin only) alongside a new "SSO Keys" tab in the admin secrets UI.

**Why:** Don't move the actual signing keypairs into the generic vault — those need the specialized `sso_signing_keys` table (rotation-by-kid, retain-old-for-verify semantics). Only plain config values (issuer, TTLs) belong in the generic vault pattern.

**How to apply:** When adding admin-configurable config to a service that has its own specialized security-critical state (keys, secrets, tokens), split cleanly: config knobs → generic vault; cryptographic material → dedicated schema/table.
