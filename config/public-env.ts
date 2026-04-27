/**
 * Client-safe env subset. `config/env.ts` imports `server-only`, so it cannot
 * be imported from a Client Component. This file mirrors only the
 * `NEXT_PUBLIC_*` keys, which Next inlines at build time.
 *
 * Keep keys here in sync with the `NEXT_PUBLIC_*` block in `config/env.ts`.
 */

export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Docket",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
} as const;

export type PublicEnv = typeof publicEnv;
