import "server-only";
import { or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Shared DB-layer helpers used across multiple routers. Live here (not in
 * any single router file) so future routers can adopt them without
 * cross-router imports.
 */

/**
 * Composite keyset-cursor predicate: `(createdAt, id) < cursor`.
 *
 * Two correctness traps this addresses:
 *
 *   1. **Identical-millisecond rows.** Single-column `< createdAt` skips
 *      rows that share the cursor's exact timestamp (trivial to hit in
 *      bulk inserts). Composite predicate adds the `(eq, lt id)` clause.
 *   2. **Microsecond → millisecond precision loss.** Postgres timestamps
 *      have microsecond resolution; postgres-js materializes them as JS
 *      `Date`s (millisecond), and the cursor round-trips at that lower
 *      resolution. Comparing `stored_microsecond` against
 *      `bound_millisecond` would silently drop rows whose microsecond
 *      value rounds to the cursor's millisecond. We work around it by
 *      truncating both sides to milliseconds in the predicate
 *      (`date_trunc('milliseconds', …)`).
 *
 * Index impact: the truncate prevents a direct index-only scan on
 * `created_at`. For Phase-1 table sizes (<100k rows) this is invisible;
 * Phase 2 adds a functional index `(date_trunc('milliseconds', created_at), id)`
 * if perf becomes an issue.
 *
 * Pair with `orderBy(desc(createdAt), desc(id))` and `limit(N + 1)` to
 * implement standard "load N items, peek ahead for hasMore" keyset paging.
 */
export function keysetLt(
  createdAtCol: PgColumn,
  idCol: PgColumn,
  cursor: { createdAt: string; id: string },
): SQL {
  // Bind as text + cast to timestamptz so postgres-js's parameter
  // serializer accepts the value. Drizzle's `sql` template doesn't
  // auto-convert raw `Date` objects.
  const ts = cursor.createdAt;
  return or(
    sql`date_trunc('milliseconds', ${createdAtCol}) < ${ts}::timestamptz`,
    sql`date_trunc('milliseconds', ${createdAtCol}) = ${ts}::timestamptz AND ${idCol} < ${cursor.id}::uuid`,
  ) as unknown as SQLWrapper as SQL;
}

/**
 * Pull a beneficiary's `fullName` out of a JSONB blob (as stored on
 * `cases.beneficiary_data`). Returns `null` when the blob isn't an
 * object, the field is missing, or the trimmed value is empty.
 *
 * Lives here (not in any single router) because the same predicate
 * shows up in both the revenue/Stripe service (line-item description)
 * and `me.*` (dashboard activity feed + today list). One source of
 * truth keeps the runtime narrowing identical across both paths.
 */
export function extractBeneficiaryFullName(blob: unknown): string | null {
  if (
    blob !== null &&
    typeof blob === "object" &&
    "fullName" in blob &&
    typeof (blob as { fullName?: unknown }).fullName === "string"
  ) {
    const v = (blob as { fullName: string }).fullName.trim();
    return v.length > 0 ? v : null;
  }
  return null;
}

/**
 * Coerce a postgres-js aggregation result to `bigint`.
 *
 * `sum(int8)::bigint` comes back as a string under postgres-js's default
 * type config — Drizzle's `sql<bigint>` is a TypeScript hint, not a
 * runtime parser. Use this on every aggregated money column so the wire
 * shape stays `bigint`.
 *
 * Returns `0n` for `null`/`undefined` so callers don't have to repeat
 * the coalesce-or-default ladder.
 */
export function bn(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  return 0n;
}

