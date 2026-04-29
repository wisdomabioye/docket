import { serve } from "inngest/next";
import { inngest } from "@/server/jobs/client";
import { inngestFunctions } from "@/server/jobs";

/**
 * Inngest serve handler. Path is registered in `config/api.routes.ts` as
 * `API_ROUTES.webhooks.inngest` (`/api/webhooks/inngest`). Configure the
 * Inngest project + dev server with this URL.
 *
 * `runtime: nodejs` — Inngest functions touch Drizzle/Postgres/SDKs that
 * aren't edge-compatible. Force a Node runtime explicitly so a future
 * default flip in Next doesn't silently break us.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
