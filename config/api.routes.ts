/**
 * Server endpoint paths (route handlers, webhooks). The path we register in
 * a third party's dashboard must match what we expose here, so the value
 * lives in one place.
 */

export const API_ROUTES = {
  trpc: "/api/trpc",
  health: "/api/health",
  webhooks: {
    stripe: "/api/webhooks/stripe",
    inngest: "/api/webhooks/inngest",
  },
} as const;

export type ApiRoutes = typeof API_ROUTES;
