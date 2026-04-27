import "server-only";
import { z } from "zod";

/**
 * Validated environment variables. Reads `process.env` once at boot and
 * throws on missing required keys — a misconfigured deploy should fail loudly,
 * not silently in a request handler later.
 *
 * Most third-party keys are `.optional()` in Stage 00 and become required as
 * their owning stage activates them. Promote a key to required in the schema
 * below when its stage starts.
 */

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),

  // Public — inlined into the client bundle by Next.
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Docket"),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),

  // Server-only.
  // Database — any Postgres works (Supabase, Neon, Railway, RDS). Drizzle
  // connects directly via this URL; nothing else is needed for DB access.
  DATABASE_URL: z.url().optional(),               // Stage 01

  // Auth.js — sessions written to our own Postgres via Drizzle adapter.
  // No Supabase Auth keys; OAuth only.
  AUTH_SECRET: z.string().min(32).optional(),              // Stage 02
  AUTH_GOOGLE_ID: z.string().min(1).optional(),
  AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
  AUTH_APPLE_ID: z.string().min(1).optional(),
  AUTH_APPLE_SECRET: z.string().min(1).optional(),
  AUTH_MICROSOFT_ID: z.string().min(1).optional(),
  AUTH_MICROSOFT_SECRET: z.string().min(1).optional(),

  // Other services.
  POSTMARK_API_KEY: z.string().min(1).optional(),          // Stage 11
  UPSTASH_REDIS_REST_URL: z.url().optional(),     // Stage 02 (rate limit)
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  INNGEST_EVENT_KEY: z.string().min(1).optional(),         // Stage 07
  INNGEST_SIGNING_KEY: z.string().min(1).optional(),
  PERPLEXITY_COMPUTER_API_KEY: z.string().min(1).optional(), // Stage 07
  STRIPE_SECRET_KEY: z.string().min(1).optional(),         // Stage 10
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "[env] Invalid environment variables:",
    z.flattenError(parsed.error).fieldErrors,
  );
  throw new Error("[env] Invalid environment — see logs above.");
}

export const env = parsed.data;
export type Env = typeof env;
