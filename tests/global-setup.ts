import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/**
 * Vitest `globalSetup`. Runs ONCE before any test worker spins up.
 *
 * Loads `.env.local` so `TEST_DATABASE_URL` is available, then applies
 * every Drizzle migration to the test DB. Drizzle's migrator is
 * idempotent (tracks applied migrations in `__drizzle_migrations`), so
 * a fresh test DB is migrated end-to-end the first time and a no-op on
 * subsequent runs.
 *
 * If `TEST_DATABASE_URL` is unset, this is a no-op and integration tests
 * skip via `getTestDb()` returning null.
 *
 * The test DB itself must exist — create it with:
 *   createdb docket_test
 * (or the equivalent on your Postgres host).
 */
export default async function setup(): Promise<void> {
  try {
    process.loadEnvFile?.(".env.local");
  } catch {
    // .env.local optional in CI / fresh-clone contexts.
  }

  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;

  const sql = postgres(url, { max: 1, prepare: false });
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: "server/db/migrations" });
  } finally {
    await sql.end();
  }
}
