/**
 * Applies pending SQL migration files (generated via `pnpm run generate`,
 * stored in `lib/db/drizzle/`) to the database pointed at by DATABASE_URL.
 *
 * Usage: pnpm --filter @workspace/db run migrate
 *
 * This is the production-safe counterpart to `drizzle-kit push` — instead of
 * diffing the live schema and applying changes directly, it runs a
 * versioned, reviewable set of SQL files in order and records which ones
 * have already been applied (in the `__drizzle_migrations` table), so it's
 * safe to run repeatedly and only ever applies what's new.
 */
import path from "path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.log("Running pending migrations...");
  await migrate(db, { migrationsFolder: path.join(__dirname, "../drizzle") });
  console.log("Migrations complete.");

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
