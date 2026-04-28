import { defineConfig } from "vitest/config";
import path from "node:path";

// `.env.local` is loaded inside each worker by `tests/setup.ts` — vitest's
// pool doesn't propagate env from this config file's process.

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Runs ONCE before any worker starts. Applies Drizzle migrations to
    // the dedicated test DB at `TEST_DATABASE_URL` (idempotent — no-op
    // when already migrated, no-op when the var is unset).
    globalSetup: ["./tests/global-setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // Integration tests share a single Postgres test DB. Cross-file
    // parallelism would race on table state during the per-file truncate.
    // Within a file, vitest already runs tests sequentially; this just
    // disables parallel *files*. Trade-off: slower full-suite run for
    // deterministic, isolated tests.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throws on import outside of a React Server bundle.
      // For tests, replace with a no-op so server modules can load.
      "server-only": path.resolve(__dirname, "./tests/helpers/server-only-shim.ts"),
    },
  },
});
