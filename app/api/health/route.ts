import { sql } from "drizzle-orm";
import { env } from "@/config/env";
import { APP_INFO } from "@/config";
import { getRedis } from "@/server/services/redis";

/**
 * Liveness/readiness probe. Path is centralized in `config/api.routes.ts`
 * as `API_ROUTES.health`.
 *
 * Per-integration semantics:
 *   - `database`: actual `select 1` ping when `DATABASE_URL` is present.
 *   - `redis`: actual `ping` round-trip when Upstash creds are present.
 *   - `perplexity`: reads the `computer:health:status` Redis key (the
 *     `computer-health` Inngest cron writes it every 5 min). NEVER calls
 *     Sonar from this route — that would be billable on every probe and
 *     a Vercel/Cloudflare aggregate could rack up real cost. When the
 *     cached value is missing, returns `unknown` (the cron may not have
 *     run yet on a fresh deploy).
 *   - `postmark`: when both `POSTMARK_API_KEY` and `POSTMARK_FROM_EMAIL`
 *     are set, calls `getServer()` (auth-only metadata read, no email
 *     side-effect, no cost) behind a short timeout. Either env var
 *     missing collapses to `not_configured` so a half-set deploy
 *     (key without sender) shows up distinctly from a fully-unset one
 *     in the surrounding `degraded` calculus.
 *   - Other integrations: env-presence only.
 *
 * `status: "ok"` only if the integrations Phase 1 actually depends on
 * (database, perplexity if configured) are connected. Optional integrations
 * are reported but don't degrade overall.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type IntegrationStatus =
  | "connected"
  | "error"
  | "not_configured"
  | "unknown";

function presence(value: string | undefined): IntegrationStatus {
  return value ? "connected" : "not_configured";
}

async function pingDatabase(): Promise<IntegrationStatus> {
  if (!env.DATABASE_URL) return "not_configured";
  try {
    // Lazy import — avoids importing the DB client (and its `server-only`
    // marker) at module load time when the env isn't set.
    const { db } = await import("@/server/db/client");
    await db.execute(sql`select 1`);
    return "connected";
  } catch {
    return "error";
  }
}

async function pingRedis(): Promise<IntegrationStatus> {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return "not_configured";
  }
  try {
    const redis = getRedis();
    if (!redis) return "not_configured";
    const reply = await redis.ping();
    return reply === "PONG" ? "connected" : "error";
  } catch {
    return "error";
  }
}

async function pingPostmark(): Promise<IntegrationStatus> {
  // Both must be set for a usable email path. Sender-without-key OR
  // key-without-sender means a misconfigured deploy that can't actually
  // send anything — surface as `not_configured` so the operator notices
  // the gap before a notification fires.
  if (!env.POSTMARK_API_KEY || !env.POSTMARK_FROM_EMAIL) {
    return "not_configured";
  }
  try {
    const { getPostmarkClient } = await import(
      "@/server/services/email/postmark-client"
    );
    const client = getPostmarkClient();
    if (!client) return "not_configured";
    // 3s timeout. Postmark's API is normally < 200ms; anything past
    // 3s is an outage we don't want to wedge the probe on.
    await Promise.race([
      client.getServer(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("postmark ping timeout")), 3_000),
      ),
    ]);
    return "connected";
  } catch {
    return "error";
  }
}

async function getCachedComputerStatus(): Promise<IntegrationStatus> {
  if (!env.PERPLEXITY_API_KEY) return "not_configured";
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    // Sonar is configured but the cache layer isn't — we have no way
    // to read the cron's verdict without a billable Sonar call. Report
    // `unknown` rather than guess.
    return "unknown";
  }
  try {
    const redis = getRedis();
    if (!redis) return "unknown";
    const cached = await redis.get<{ status: "up" | "down" }>(
      "computer:health:status",
    );
    if (!cached) return "unknown"; // cron hasn't run yet
    return cached.status === "up" ? "connected" : "error";
  } catch {
    return "error";
  }
}

export async function GET() {
  const [database, redis, perplexity, postmark] = await Promise.all([
    pingDatabase(),
    pingRedis(),
    getCachedComputerStatus(),
    pingPostmark(),
  ]);

  // Degraded only on hard errors of dependencies we actively use.
  // `not_configured` and `unknown` aren't degradations — they're
  // diagnostic info for the operator.
  const overall =
    database === "error" ||
    perplexity === "error" ||
    redis === "error" ||
    postmark === "error"
      ? "degraded"
      : "ok";

  return Response.json({
    status: overall,
    app: APP_INFO.name,
    env: env.NODE_ENV,
    integrations: {
      database,
      auth: presence(env.AUTH_SECRET),
      authGoogle: presence(env.AUTH_GOOGLE_ID),
      authMicrosoft: presence(env.AUTH_MICROSOFT_ID),
      perplexity,
      stripe: presence(env.STRIPE_SECRET_KEY),
      postmark,
      inngest: presence(env.INNGEST_EVENT_KEY),
      redis,
      // PostHog is gated only on the public key — host has a sensible
      // default (`https://us.i.posthog.com`), so a deploy with key
      // alone is fully functional. We do NOT hit any PostHog endpoint
      // here: their `/capture` would create a phantom event under the
      // health-check origin, and `/decide` would create a person
      // profile per probe — both burn quota and skew dashboards.
      // Connectivity issues surface elsewhere — Sentry catches the
      // emit-side errors via the `trackServer` try/catch.
      posthog: presence(env.NEXT_PUBLIC_POSTHOG_KEY),
    },
    timestamp: new Date().toISOString(),
  });
}
