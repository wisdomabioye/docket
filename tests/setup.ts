// Load .env.local inside every worker — vitest's pool doesn't propagate
// env from the config file process. Node 20.12+ ships `loadEnvFile`.
try {
  process.loadEnvFile?.(".env.local");
} catch {
  // optional in CI / contributors without local env
}

import "@testing-library/jest-dom/vitest";
