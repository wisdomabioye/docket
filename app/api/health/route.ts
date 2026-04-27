import { env } from "@/config/env";
import { APP_INFO } from "@/config";

/**
 * Liveness/readiness probe. Path is centralized in `config/api.routes.ts`
 * as `API_ROUTES.health` — keep this file's location aligned with that
 * constant.
 *
 * Each integration field upgrades from `"not_configured"` → `"connected"`
 * as its env var arrives in a later stage.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function status(present: boolean): "connected" | "not_configured" {
  return present ? "connected" : "not_configured";
}

export async function GET() {
  return Response.json({
    status: "ok",
    app: APP_INFO.name,
    env: env.NODE_ENV,
    integrations: {
      database: status(Boolean(env.DATABASE_URL)),
      auth: status(Boolean(env.AUTH_SECRET)),
      computer: status(Boolean(env.PERPLEXITY_COMPUTER_API_KEY)),
      stripe: status(Boolean(env.STRIPE_SECRET_KEY)),
      postmark: status(Boolean(env.POSTMARK_API_KEY)),
      inngest: status(Boolean(env.INNGEST_EVENT_KEY)),
      redis: status(Boolean(env.UPSTASH_REDIS_REST_URL)),
    },
    timestamp: new Date().toISOString(),
  });
}
