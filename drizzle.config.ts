import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit reads `DATABASE_URL` from the shell, but `pnpm db:*` runs
 * outside Next.js so `.env.local` isn't loaded automatically. Use Node's
 * built-in (Node 20.12+) — zero deps, no `dotenv-cli` wrapper needed.
 *
 * All migration files live in `server/db/migrations/` — both the
 * drizzle-kit-generated ones and the `--custom` ones we hand-fill.
 * `pnpm db:migrate` runs them all in lexical order.
 */
process.loadEnvFile?.(".env.local");

export default defineConfig({
  schema: "./server/db/schema/index.ts",
  out: "./server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
  casing: "snake_case",
});
