---
name: Production Release Pipeline
description: Release build scripts, PM2 config, and VPS deployment tooling for Signalium Platform.
---

## What was built

Scripts for building a self-contained release tarball for VPS deployment:

- `ecosystem.config.cjs` — PM2 config (fork mode, ESM-compatible, zero-downtime reload)
- `scripts/build-migrate.mjs` — bundles `lib/db/src/migrate.ts` with esbuild
- `scripts/build-release.sh` — full build + assemble pipeline
- `scripts/package-release.sh` — creates `signalium-platform-release.tar.gz`
- `scripts/deploy-check.sh` — pre-deploy verification (env, DB, PM2, ports, artifacts)
- `docs/PRODUCTION_DEPLOYMENT.md` — release-artifact deploy guide (complements DEPLOYMENT_GUIDE.md)

## Key design decisions

**esbuild resolution:** esbuild is NOT hoisted to workspace root — only in `artifacts/api-server/node_modules`. `scripts/build-migrate.mjs` uses `createRequire(apiServerPkg)` to resolve it from there.

**Why:** `import { build } from 'esbuild'` fails from scripts/ because pnpm does not hoist esbuild.

**Migration path alignment:** `migrate.ts` uses `path.join(__dirname, "../drizzle")`. Bundled to `release/dist/server/migrate.mjs` → `__dirname` = `release/dist/server/` → `../drizzle` = `release/dist/drizzle/`. build-release.sh copies SQL files to `release/dist/drizzle/` to match.

**Why:** Avoid modifying migrate.ts; let the bundle path do the work.

**Runtime externals in release/package.json:** `nodemailer` and `@google-cloud/storage` are in esbuild's external list (can't be bundled). Release needs its own `package.json` + `npm install --omit=dev` on VPS.

**Why:** These packages use dynamic requires / native bindings esbuild cannot inline.

**exec_mode: fork** in PM2 config: required for ESM (.mjs) entry points. Cluster mode breaks ES module semantics.

**Why:** `pm2 reload` still achieves near-zero-downtime with fork mode when Nginx upstream buffering is enabled.

**Vite build env vars:** `vite.config.ts` throws if PORT or BASE_PATH are missing at config-eval time (even for builds). `build-release.sh` supplies `PORT=3000 BASE_PATH=/` before running the Vite build.

**How to apply:** Any CI pipeline building the frontend must set both vars.
