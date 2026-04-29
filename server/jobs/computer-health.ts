import "server-only";
import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { getRedis } from "@/server/services/redis";
import { getComputerClient } from "@/server/services/computer/factory";
import { ComputerError } from "@/server/services/computer/types";

/**
 * Computer-health watchdog. Every 5 minutes, ping the computer client
 * (`SonarClient.ping()` → 1-token chat call; `MockComputerClient.ping()`
 * → no-op resolves true). Write the result to Redis under
 * `computer:health:status` so `/api/health` can return it without
 * pinging Sonar on every probe (which would be billable + slow).
 *
 * Edge-transition behavior: emit `system/computer.degraded` exactly when
 * the status flips from `up` → `down`. Re-emitting on every cycle while
 * down would spam the on-call channel; the admin alert function fires
 * once per outage.
 *
 * If Redis isn't configured (local dev, CI), the function still runs
 * and returns the live status — it just can't persist or detect the
 * edge transition. That's fine: `/api/health` falls back to a live
 * presence check in dev.
 *
 * `NotConfigured` from the client (no PERPLEXITY_API_KEY) → throw
 * `NonRetriableError` so Inngest doesn't retry the cron unnecessarily;
 * the next scheduled tick will pick up changed env. (In practice the
 * factory routes to `MockComputerClient` when the key is unset, so this
 * branch is reached only when Sonar is configured but rejects auth.)
 */

const HEALTH_KEY = "computer:health:status";
/** TTL just under 3× cron period — a stalled cron leaves no stale data. */
const HEALTH_TTL_SECONDS = 14 * 60;

type HealthStatus = {
  status: "up" | "down";
  checkedAt: string;
  lastError?: string;
};

export const computerHealth = inngest.createFunction(
  {
    id: "computer-health",
    // Single in-flight cron: skip overlap if a previous tick is still running.
    concurrency: { limit: 1 },
    // The cron itself shouldn't retry — the next scheduled tick is the retry.
    retries: 0,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const live = await step.run("ping", async () => {
      try {
        await getComputerClient().ping();
        return { status: "up" as const };
      } catch (err) {
        if (err instanceof ComputerError && err.code === "NotConfigured") {
          throw new NonRetriableError(
            `computer-health: client not configured: ${err.message}`,
            { cause: err },
          );
        }
        return {
          status: "down" as const,
          lastError: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const checkedAt = new Date().toISOString();
    const next: HealthStatus = {
      status: live.status,
      checkedAt,
      ...(live.status === "down" && live.lastError
        ? { lastError: live.lastError }
        : {}),
    };

    const redis = getRedis();
    let prevStatus: HealthStatus["status"] | null = null;
    if (redis) {
      // Read prior status so we can detect the up → down edge transition.
      // Upstash `get` on a JSON value returns the parsed object directly
      // (the SDK uses `Type` parameter; we cast since we control the writer).
      const prev = await step.run("read-prior", async () =>
        redis.get<HealthStatus>(HEALTH_KEY),
      );
      prevStatus = prev?.status ?? null;
      await step.run("write-status", async () =>
        redis.set(HEALTH_KEY, next, { ex: HEALTH_TTL_SECONDS }),
      );
    }

    if (live.status === "down" && prevStatus !== "down") {
      // Edge: up → down (or unknown → down on first observation). Fire the
      // alert event exactly once per outage.
      await step.sendEvent("emit-degraded", {
        name: "system/computer.degraded",
        data: { since: checkedAt },
      });
    }

    return next;
  },
);
