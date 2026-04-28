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

const schema = z
  .object({
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
    DATABASE_URL: z.url().optional(), // Stage 01

    // Test-only Postgres URL. Tests run against this DB instead of
    // `DATABASE_URL` so the dev DB stays clean. Migrations apply
    // automatically via `tests/global-setup.ts`. Optional in normal runs;
    // when unset, integration tests skip cleanly.
    TEST_DATABASE_URL: z.url().optional(),

    // Auth.js — sessions written to our own Postgres via Drizzle adapter.
    // No Supabase Auth keys; OAuth only.
    AUTH_SECRET: z.string().min(32).optional(), // Stage 02
    AUTH_GOOGLE_ID: z.string().min(1).optional(),
    AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
    AUTH_APPLE_ID: z.string().min(1).optional(),
    AUTH_APPLE_SECRET: z.string().min(1).optional(),
    AUTH_MICROSOFT_ID: z.string().min(1).optional(),
    AUTH_MICROSOFT_SECRET: z.string().min(1).optional(),

    /**
     * One-time bootstrap: when this email signs in via SSO and no admin
     * exists yet in `user_roles`, the invite gate lets them through and
     * `onSignIn()` auto-grants them the `admin` role + activates their
     * attorney profile. Self-disabling — once any admin exists, this
     * variable is inert. See `server/auth/invite-gate.ts` and
     * `server/auth/onboarding.ts`.
     *
     * Lowercased on parse so case mismatches between env file and SSO
     * profile don't silently disable the bootstrap.
     */
    ADMIN_BOOTSTRAP_EMAIL: z
      .email()
      .transform((s) => s.toLowerCase())
      .optional(),

    // Other services.
    POSTMARK_API_KEY: z.string().min(1).optional(), // Stage 11
    UPSTASH_REDIS_REST_URL: z.url().optional(), // Stage 02 (rate limit)
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
    INNGEST_EVENT_KEY: z.string().min(1).optional(), // Stage 07
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    // Perplexity Sonar API. SDK convention is `PERPLEXITY_API_KEY` (the
    // official `@perplexity-ai/perplexity_ai` package reads it by default).
    // Was `PERPLEXITY_COMPUTER_API_KEY` pre-Stage-07 — that legacy name
    // referred to the deprecated "Perplexity Computer" product; we use
    // Sonar now (chat completions with web grounding).
    PERPLEXITY_API_KEY: z.string().min(1).optional(), // Stage 07
    STRIPE_SECRET_KEY: z.string().min(1).optional(), // Stage 10
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    // OAuth pair invariants — half-set creds would silently drop the
    // provider from the login page. Fail loudly at boot.
    const PAIRS: Array<[idKey: keyof typeof v, secretKey: keyof typeof v]> = [
      ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"],
      ["AUTH_MICROSOFT_ID", "AUTH_MICROSOFT_SECRET"],
      ["AUTH_APPLE_ID", "AUTH_APPLE_SECRET"],
    ];
    for (const [idKey, secretKey] of PAIRS) {
      if (Boolean(v[idKey]) !== Boolean(v[secretKey])) {
        ctx.addIssue({
          code: "custom",
          message: `${idKey} and ${secretKey} must both be set or both unset`,
          path: [secretKey],
        });
      }
    }

    // If ANY provider is configured, AUTH_SECRET is required — otherwise
    // Auth.js crashes at first sign-in instead of at boot.
    const anyProviderSet = PAIRS.some(
      ([idKey, secretKey]) => v[idKey] && v[secretKey],
    );
    if (anyProviderSet && !v.AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        message:
          "AUTH_SECRET is required when any OAuth provider is configured (run `openssl rand -base64 32`)",
        path: ["AUTH_SECRET"],
      });
    }
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
