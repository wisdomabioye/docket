import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "./redis";

/**
 * Per-procedure sliding-window rate limiters. Limits live in one place so
 * the spec's caps (e.g. `case.requestBuild` 10/hr) are auditable. Identifier
 * is always user-scoped — pass `userId` from the tRPC context, never an
 * IP, so a shared NAT doesn't penalize the wrong account.
 *
 * Behavior when Upstash isn't configured (local dev, CI, unit tests):
 * limiter returns `success: true` so the request flows. Production deploys
 * MUST set `UPSTASH_REDIS_REST_URL` + `_TOKEN` — the readiness checklist
 * in Stage 12 verifies this.
 *
 * Limits source-of-truth: Stage 07 spec §"Edge Cases" + spec §17.5.
 *   - `case.requestBuild`  → 10 / hour (expensive: spawns ~5 LLM jobs)
 *   - `mutation.default`   → 60 / minute (catch-all for tRPC mutations)
 *
 * Add new limits here, not at the call site — the call site picks a name
 * and stays declarative.
 */

export type RateLimitName =
  | "case.requestBuild"
  | "output.regenerate"
  | "mutation.default";

type LimitConfig = {
  limit: number;
  /** Sliding window duration in `@upstash/ratelimit`'s `Duration` string. */
  window: `${number} ${"s" | "m" | "h" | "d"}`;
};

// `mutation.default` is intentionally registered but unused at the call
// sites — it's the cap that the future "rate-limit every mutation"
// middleware will apply (Stage 12 readiness checklist). Keeping it here
// means the limit lives in one place when that middleware lands.
const LIMITS: Record<RateLimitName, LimitConfig> = {
  "case.requestBuild": { limit: 10, window: "1 h" },
  // 20/hr per attorney — Stage 08 review flow lets attorneys regenerate
  // a single output (vs. the whole pipeline). Looser than `case.requestBuild`
  // because per-output regen burns ~1/5th the budget of a full build.
  "output.regenerate": { limit: 20, window: "1 h" },
  "mutation.default": { limit: 60, window: "1 m" },
};

const cache = new Map<RateLimitName, Ratelimit | null>();

/** Resolve a limiter for `name`, lazily constructing it. `null` means
 *  Redis is unconfigured and limits are bypassed. */
function getLimiter(name: RateLimitName): Ratelimit | null {
  if (cache.has(name)) return cache.get(name)!;
  const redis = getRedis();
  if (!redis) {
    cache.set(name, null);
    return null;
  }
  const cfg = LIMITS[name];
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(cfg.limit, cfg.window),
    // Prefix isolates docket counters from anything else sharing the
    // Upstash project; keeps key namespaces tidy in the dashboard.
    prefix: `docket:rl:${name}`,
    analytics: false,
  });
  cache.set(name, limiter);
  return limiter;
}

export type RateLimitResult = {
  success: boolean;
  /** Configured cap (always positive). */
  limit: number;
  /** Tokens left in the current window. `limit` when bypassed. */
  remaining: number;
  /** Unix epoch ms when the window resets. `0` when bypassed. */
  reset: number;
};

/** Check + consume one token for `(name, identifier)`. Identifier is
 *  always a stable user id; the limiter is per-user, not per-IP. */
export async function rateLimit(
  name: RateLimitName,
  identifier: string,
): Promise<RateLimitResult> {
  const limiter = getLimiter(name);
  if (!limiter) {
    const cfg = LIMITS[name];
    return { success: true, limit: cfg.limit, remaining: cfg.limit, reset: 0 };
  }
  const res = await limiter.limit(identifier);
  return {
    success: res.success,
    limit: res.limit,
    remaining: res.remaining,
    reset: res.reset,
  };
}

/** Test-only — clears cached limiter instances so a test can swap env. */
export function __resetRateLimitForTest(): void {
  cache.clear();
}
