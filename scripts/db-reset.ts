/**
 * Run with: `pnpm db:reset`
 *
 * Truncates every table in the `public` schema, resetting identity sequences
 * and cascading FKs. Preserves the `__drizzle_migrations` row so migrations
 * remain marked as applied — no need to re-run `db:migrate` after this.
 *
 * SAFETY: refuses to run when NODE_ENV=production. Requires `--yes` flag.
 */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[db:reset] DATABASE_URL is not set");
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("[db:reset] refuses to run with NODE_ENV=production");
  process.exit(1);
}
if (!process.argv.includes("--yes")) {
  console.error("[db:reset] destructive — re-run with `--yes` to confirm");
  process.exit(1);
}

const client = postgres(DATABASE_URL, { max: 1, prepare: false });
const db = drizzle(client);

async function main(): Promise<void> {
  console.log("[db:reset] truncating all tables in public schema…");
  await db.execute(sql`
    DO $$
    DECLARE
      table_list text;
    BEGIN
      SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
        INTO table_list
        FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename <> '__drizzle_migrations';

      IF table_list IS NULL THEN
        RAISE NOTICE 'no tables to truncate';
      ELSE
        EXECUTE 'TRUNCATE TABLE ' || table_list || ' RESTART IDENTITY CASCADE';
      END IF;
    END $$;
  `);
  console.log("[db:reset] done");
}

main()
  .catch((err) => {
    console.error("[db:reset] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await client.end();
  });
