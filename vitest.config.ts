import { defineConfig } from "vitest/config";
import path from "node:path";

// `.env.local` is loaded inside each worker by `tests/setup.ts` — vitest's
// pool doesn't propagate env from this config file's process.

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
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
