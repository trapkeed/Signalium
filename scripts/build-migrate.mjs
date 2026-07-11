/**
 * Bundles lib/db/src/migrate.ts into a standalone Node.js script.
 *
 * Output: release/dist/server/migrate.mjs
 *
 * The bundled file is self-contained (pg + drizzle-orm bundled in) and requires
 * only DATABASE_URL in the environment. SQL migration files must be present at
 * release/dist/drizzle/ (which is where build-release.sh copies them), and the
 * bundled migrate.mjs references them via path.join(__dirname, "../drizzle") —
 * resolving correctly from release/dist/server/ → release/dist/drizzle/.
 *
 * esbuild is resolved from artifacts/api-server/node_modules (not root) because
 * pnpm does not hoist it to the workspace root. createRequire anchors the
 * resolution to the api-server package so it is always found after pnpm install.
 *
 * Called by scripts/build-release.sh — not intended for direct use.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");

// Resolve esbuild from the api-server package where it is installed.
const apiServerPkg = path.resolve(workspaceRoot, "artifacts/api-server/package.json");
const requireFromApiServer = createRequire(apiServerPkg);
const { build: esbuild } = requireFromApiServer("esbuild");

const outFile = path.resolve(workspaceRoot, "release/dist/server/migrate.mjs");
const entryPoint = path.resolve(workspaceRoot, "lib/db/src/migrate.ts");

await mkdir(path.dirname(outFile), { recursive: true });

await esbuild({
  entryPoints: [entryPoint],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: outFile,
  logLevel: "info",
  // pg uses native bindings optionally — exclude them so the bundle stays pure JS.
  external: ["*.node", "pg-native"],
  sourcemap: "linked",
  // Same CJS-compat banner used by the main API server build.
  // Ensures __dirname is defined (migrate.ts uses path.join(__dirname, "../drizzle")).
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
  },
});

console.log(`\n✅ Migration runner bundled → ${outFile}\n`);
