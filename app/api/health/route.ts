import { sql } from "drizzle-orm";
import { env } from "@/config/env";
import { APP_INFO } from "@/config";

/**
 * Liveness/readiness probe. Path is centralized in `config/api.routes.ts`
 * as `API_ROUTES.health`.
 *
 * `database`: actually pings via `select 1` when `DATABASE_URL` is present.
 * Other integrations: env-presence only until their owning stage activates them.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type IntegrationStatus = "connected" | "error" | "not_configured";

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

export async function GET() {
  const database = await pingDatabase();
  const overall = database === "error" ? "degraded" : "ok";

  return Response.json({
    status: overall,
    app: APP_INFO.name,
    env: env.NODE_ENV,
    integrations: {
      database,
      auth: presence(env.AUTH_SECRET),
      computer: presence(env.PERPLEXITY_COMPUTER_API_KEY),
      stripe: presence(env.STRIPE_SECRET_KEY),
      postmark: presence(env.POSTMARK_API_KEY),
      inngest: presence(env.INNGEST_EVENT_KEY),
      redis: presence(env.UPSTASH_REDIS_REST_URL),
    },
    timestamp: new Date().toISOString(),
  });
}
