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
  | "case.markFiled"
  | "output.regenerate"
  | "output.saveDraft"
  | "revenue.logFee"
  | "revenue.adjust"
  | "revenue.generateInvoice"
  | "search.global"
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
  // Stage 08 / ADR-006 — `case.markFiled` is idempotent on `filedAt`,
  // so spam is harmless after the first success. The limit exists to
  // catch a pathological retry loop (UI bug or malicious client) and
  // to bound the receipt-collision dance (each call holds the case
  // row briefly). 30/hour is generous for one human attorney.
  "case.markFiled": { limit: 30, window: "1 h" },
  // 20/hr per attorney — Stage 08 review flow lets attorneys regenerate
  // a single output (vs. the whole pipeline). Looser than `case.requestBuild`
  // because per-output regen burns ~1/5th the budget of a full build.
  "output.regenerate": { limit: 20, window: "1 h" },
  // Stage 11 W5 global search — debounced 250ms client-side. 60/min
  // = one request per second average, plenty of headroom for normal
  // typing without inviting a runaway client to thrash the trigram
  // index. The search router also short-circuits empty `q` so the
  // limiter only counts requests that actually run SQL.
  "search.global": { limit: 60, window: "1 m" },
  // Stage 11 W3 autosave fires on a 3s debounce per editor instance.
  // Worst case: attorney rapidly opens 3 outputs in tabs and edits all
  // three concurrently → ~60 saves/min. 120/min headroom prevents the
  // rate limiter from clobbering legitimate editing while still
  // catching a pathological client (mis-tuned debounce, runaway script).
  // The DB-side idempotency check in `saveOutputDraft` already drops
  // no-op writes; this cap is the upper bound for actual-content writes.
  "output.saveDraft": { limit: 120, window: "1 m" },
  // Stage 10 revenue mutations. logFee gets the default mutation cap
  // (free DB write, but spam = audit/event noise). Adjust + generate
  // are admin-only and tighter — generateInvoice burns Stripe API
  // budget per call (one Invoice + N InvoiceItems).
  "revenue.logFee": { limit: 60, window: "1 m" },
  "revenue.adjust": { limit: 30, window: "1 m" },
  "revenue.generateInvoice": { limit: 10, window: "1 m" },
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
