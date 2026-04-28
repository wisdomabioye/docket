import "server-only";
import { env } from "@/config/env";
import { SonarClient } from "./http";
import { MockComputerClient } from "./mock";
import type { ComputerClient } from "./types";

/**
 * Resolves the active `ComputerClient` per environment. When
 * `PERPLEXITY_API_KEY` is set the real `SonarClient` ships; otherwise
 * the mock returns deterministic stamped output so the rest of the
 * pipeline (Inngest jobs, status transitions, cost ledger) is
 * exercisable in dev / CI without a key.
 *
 * The factory result is recomputed per call — cheap, and lets tests
 * swap env vars between cases without module reload gymnastics.
 *
 * Stage 07 ships the `null` fallback policy per `open_issues.md` #19;
 * a future composite client wraps the primary + a second provider here.
 */
export function getComputerClient(): ComputerClient {
  if (env.PERPLEXITY_API_KEY) {
    return new SonarClient();
  }
  return new MockComputerClient();
}
