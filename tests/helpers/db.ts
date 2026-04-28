import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "@/server/db/schema";

export type TestDb = PostgresJsDatabase<typeof schema>;

let cachedClient: Sql | null = null;
let cachedDb: TestDb | null = null;

/**
 * Connect to the **test** DB. Reads `TEST_DATABASE_URL` (NOT `DATABASE_URL`)
 * so tests never touch the developer's dev DB. Returns `null` when the
 * variable is unset so integration tests skip cleanly (CI without
 * services, contributor without local Postgres). Cached — repeated calls
 * reuse the same connection.
 *
 * Schema migrations are auto-applied to the test DB on `pnpm test` startup
 * by `tests/global-setup.ts`; per-file `beforeAll` in `tests/setup.ts`
 * truncates every app table so each test file starts pristine.
 */
export function getTestDb(): TestDb | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  if (!cachedDb) {
    cachedClient = postgres(url, {
      max: 2,
      prepare: false,
    });
    cachedDb = drizzle(cachedClient, { schema, casing: "snake_case" });
  }
  return cachedDb;
}

/**
 * Returns true when the `app_user` role exists. The RLS test suite gates
 * on this — without the role, `set local role app_user` would fail and
 * tests would be misleading.
 */
export async function rlsRoleExists(db: TestDb): Promise<boolean> {
  const rows = await db.execute<{ exists: boolean }>(
    sql`select exists (select 1 from pg_roles where rolname = 'app_user') as exists`,
  );
  return rows[0]?.exists === true;
}

/**
 * Run `fn` inside a transaction with the `app_user` role engaged and the
 * per-request session GUC set to `userId` (or unset, for anon queries).
 * RLS policies see this exactly as Stage 02's proxy.ts will at runtime.
 *
 * `set_config(name, value, is_local=true)` parameterizes the user id —
 * mirrors the safe pattern Stage 02 must use (the user id arrives from a
 * cookie; never interpolate via `sql.raw`).
 *
 * The transaction is rolled back at the end via the sentinel pattern so
 * tests don't accumulate state. Throwing is the only way to signal
 * rollback to drizzle's `db.transaction()`.
 */
export async function asUser<T>(
  db: TestDb,
  userId: string | null,
  fn: (tx: TestDb) => Promise<T>,
): Promise<T> {
  return await db
    .transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      await tx.execute(
        sql`select set_config('app.current_user_id', ${userId ?? ""}, true)`,
      );
      const value = await fn(tx as unknown as TestDb);
      throw new TestRollback(value);
    })
    .catch((err: unknown) => {
      if (err instanceof TestRollback) return err.value as T;
      throw err;
    });
}

/**
 * Sentinel error used by `asUser` to roll back its transaction without
 * committing. Drizzle's `db.transaction()` only rolls back on throw, so
 * we throw a tagged error and unwrap it in `.catch()`.
 */
class TestRollback<T> extends Error {
  constructor(public readonly value: T) {
    super("__test_rollback__");
  }
}

export async function closeTestDb(): Promise<void> {
  if (cachedClient) {
    await cachedClient.end();
    cachedClient = null;
    cachedDb = null;
  }
}
