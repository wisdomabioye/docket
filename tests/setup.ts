// Load .env.local inside every worker — vitest's pool doesn't propagate
// env from the config file process. Node 20.12+ ships `loadEnvFile`.
try {
  process.loadEnvFile?.(".env.local");
} catch {
  // optional in CI / contributors without local env
}

// Point production code at the test DB. `server/db/client.ts` reads
// `env.DATABASE_URL` at import time, so this swap MUST happen before any
// production module is imported (the imports below transitively pull
// `env.ts`). Without this, tests would write to the test DB but
// production code (e.g. `isInvitePermitted`, `onSignIn`) would read/write
// the dev DB — silent split-brain.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Force deterministic mock backends regardless of what the dev env
// has configured. Tests that *want* to exercise the real R2 / Sonar
// integrations would set these explicitly themselves. Without these
// overrides, a developer with `PERPLEXITY_API_KEY` or
// `STORAGE_BACKEND=s3` in `.env.local` sees flaky failures across
// every job-runner / signed-URL test because the suite hits real
// services it doesn't mean to.
delete process.env.PERPLEXITY_API_KEY;
process.env.STORAGE_BACKEND = "local";

import { afterAll, beforeAll } from "vitest";
import "@testing-library/jest-dom/vitest";
import { closeTestDb, getTestDb } from "./helpers/db";
import { truncateAllAppTables } from "./helpers/truncate";

/**
 * Per-file isolation. Runs before every test file's own `beforeAll`. Wipes
 * every app table so each file starts pristine — no per-suite teardown
 * needed, no leftover rows after a crashed test, and the dev DB is never
 * touched (we connect to `TEST_DATABASE_URL`).
 *
 * No-op when `TEST_DATABASE_URL` is unset — integration tests skip via
 * `getTestDb()` returning null in that case.
 */
beforeAll(async () => {
  const db = getTestDb();
  if (!db) return;
  await truncateAllAppTables(db);
});

// Close the test DB pool when the worker tears down, so vitest doesn't
// hang waiting for an open socket.
afterAll(async () => {
  await closeTestDb();
});
