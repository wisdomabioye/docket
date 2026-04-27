import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/config/env";
import * as schema from "./schema";

if (!env.DATABASE_URL) {
  throw new Error("[db] DATABASE_URL is required to import @/server/db/client");
}

/**
 * `prepare: false` is required when connecting through a transaction-mode
 * pooler (PgBouncer, Supavisor). It's harmless on a direct connection.
 *
 * `max: 1` keeps the connection count bounded in serverless environments —
 * each request gets its own short-lived connection from the pooler.
 */
const queryClient = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 1,
});

export const db = drizzle(queryClient, { schema, casing: "snake_case" });
export type Db = typeof db;

/** Raw client for migrations + maintenance scripts that need to bypass schema. */
export const sql = queryClient;
