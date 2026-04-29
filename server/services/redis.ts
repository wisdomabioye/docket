import "server-only";
import { Redis } from "@upstash/redis";
import { env } from "@/config/env";

/**
 * Lazy singleton Upstash Redis client. Returns `null` when the REST
 * URL/token aren't configured — callers (ratelimit, computer-health)
 * decide how to degrade.
 *
 * Module-load construction is avoided so unrelated code that imports
 * this file in environments without Redis configured (CI, local dev,
 * unit tests) doesn't crash on `new Redis(...)`. The client itself is
 * cheap once created — just an HTTP wrapper — so a single shared
 * instance is correct.
 */

let cached: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    cached = null;
    return null;
  }
  cached = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return cached;
}

/** Test-only — clears the cached client so a test can swap env state. */
export function __resetRedisForTest(): void {
  cached = undefined;
}
