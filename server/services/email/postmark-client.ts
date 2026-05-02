import "server-only";

/**
 * Lazy-init Postmark `ServerClient` singleton. Mirror of the analytics
 * `getClient()` pattern in `server/services/analytics/server.ts`:
 *
 *   - Constructed on first use, cached across warm Vercel invocations.
 *   - Returns `null` when `POSTMARK_API_KEY` is unset — caller no-ops.
 *   - Test reset helper exported so each test file can swap the
 *     singleton without leaking instances between cases.
 *
 * The Postmark SDK reads its config at construction; there's no
 * separate `init()` step. Token rotation requires a process restart
 * (which Vercel deploys are anyway).
 */

import { ServerClient } from "postmark";
import { env } from "@/config/env";

let cachedClient: ServerClient | null = null;

export function getPostmarkClient(): ServerClient | null {
  if (cachedClient) return cachedClient;
  if (!env.POSTMARK_API_KEY) return null;
  cachedClient = new ServerClient(env.POSTMARK_API_KEY);
  return cachedClient;
}

/** Test helper. Drops the cached singleton so the next `getPostmarkClient`
 *  call constructs a fresh one against whatever env state the test set
 *  up. NOT for production use. */
export function __resetPostmarkClientForTests(): void {
  cachedClient = null;
}
