/**
 * Run with: `pnpm db:migrate`
 *
 * Applies every SQL file in `server/db/migrations/` in lexical order, using
 * Drizzle's standard migrator (tracked via the `__drizzle_migrations` table).
 *
 * Two kinds of files live here:
 *   - Generated:  `pnpm db:generate` — produced from schema/*.ts diff.
 *   - Custom:     `pnpm db:generate --custom --name=rls` — empty SQL file
 *                 you fill in with extensions, triggers, RLS policies,
 *                 column comments, anything Drizzle's DSL can't express.
 *
 * Both run through the same migrator; both get tracked. No separate folder.
 *
 * Env: `DATABASE_URL` is supplied by `tsx --env-file=.env.local` in the
 * package script — no `dotenv` required.
 */

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "server/db/migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false });

try {
  console.log("[migrate] applying migrations from", MIGRATIONS_DIR);
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
  console.log("[migrate] done");
} catch (err) {
  console.error("[migrate] failed:", err);
  process.exitCode = 1;
} finally {
  await client.end();
}
