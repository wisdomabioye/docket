import { sql } from "drizzle-orm";
import type { TestDb } from "./db";

/**
 * Truncate every application table in the `public` schema. Skips Drizzle's
 * own bookkeeping (`__drizzle_migrations`) so migrations don't re-run on
 * every test file.
 *
 * `RESTART IDENTITY` resets sequences (so serial primary keys start from 1
 * again on each file). `CASCADE` chases foreign keys, so we don't have to
 * order the truncations.
 *
 * Run as the connection's default role (DB owner). `app_user` lacks
 * TRUNCATE privilege — by design — so test code uses owner connections
 * for setup/teardown, mirroring how `server/db/client.ts`'s default `db`
 * is used by system code (jobs, admin scripts).
 *
 * Idempotent: cheap to run before every test file.
 */
export async function truncateAllAppTables(db: TestDb): Promise<void> {
  // Discover tables once. The list is small and stable per schema, but
  // recomputing per call keeps this helper resilient to mid-suite migrations.
  const rows = await db.execute<{ table_name: string }>(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and table_name <> '__drizzle_migrations'
  `);

  if (rows.length === 0) return;

  const quoted = rows.map((r) => `"public"."${r.table_name}"`).join(", ");
  // sql.raw is safe here — table_name comes from information_schema, not
  // user input. Identifiers are double-quoted for safety against future
  // mixed-case names.
  await db.execute(sql.raw(`truncate table ${quoted} restart identity cascade`));
}
