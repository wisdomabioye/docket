import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/config/env";
import * as schema from "./schema";

if (!env.DATABASE_URL) {
  throw new Error("[db] DATABASE_URL is required to import @/server/db/client");
}

/**
 * Pool sizing notes:
 *
 * - `prepare: false` — required for transaction-mode poolers (PgBouncer,
 *   Supavisor). Harmless on a direct connection.
 * - `max: 10` — every Auth.js `auth()`, every tRPC procedure, and every
 *   server-component `api.X.Y()` opens a connection. Keeping max:1 (the
 *   old setting) serializes all of those across every request, so a single
 *   page render that calls `auth()` then `me.current()` waits on itself.
 *   10 is comfortable for one Next.js dev process; production values come
 *   from the deploy-time deduction (Vercel functions vs. self-host).
 * - `idle_timeout: 20` — close idle connections after 20s. Lets serverless
 *   environments scale down without holding sockets.
 */
const queryClient = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
});

export const db = drizzle(queryClient, { schema, casing: "snake_case" });
export type Db = typeof db;

/** Raw client for migrations + maintenance scripts that need to bypass schema. */
export const sql = queryClient;
