import "server-only";

/**
 * PostHog server wrapper. Mirror of `lib/analytics/client.ts` for code
 * paths that emit from a tRPC procedure, an Inngest job, or a webhook
 * route handler.
 *
 * Design parity with the client wrapper:
 *  - Same typed `track()` signature, same PII guard, same
 *    dev-throws / prod-Sentry-and-drop policy.
 *  - Difference: the server has no browser cookie, so `distinctId` is
 *    a required argument on every emit. Pass `userId` from the tRPC
 *    context, or a stable system identity (`"system:<source>"`) for
 *    events that aren't attributable to a user (e.g. webhook fans).
 *
 * Init / lifecycle:
 *  - Single cached `PostHog` instance per process. `getClient()`
 *    constructs lazily so a missing env var means the wrapper no-ops
 *    rather than crashing at import time.
 *  - We use `captureImmediate()` (HTTP per event) instead of `capture()`
 *    (batched, flushed on `shutdown()`). Vercel serverless functions
 *    terminate the moment the response is sent — a batched event in
 *    flight gets dropped. The per-event cost is acceptable for our
 *    volume; revisit if we move to a long-lived server runtime.
 *  - PostHog uses a single project API key for both client and server
 *    captures, so we reuse `NEXT_PUBLIC_POSTHOG_KEY`. The "personal
 *    API key" (management API) is intentionally not loaded here.
 */

import { PostHog } from "posthog-node";
import * as Sentry from "@sentry/nextjs";
import { type AnalyticsEvent, payloadHasPii } from "@/lib/analytics/events";
import { handlePiiViolation } from "@/lib/analytics/pii-guard";
import { sanitizeProperties } from "@/lib/analytics/sanitize";
import { env } from "@/config/env";

let cachedClient: PostHog | null = null;

/** Lazily construct the singleton. Returns null when the public key is
 *  unset — the wrapper then no-ops. Caches across warm invocations. */
function getClient(): PostHog | null {
  if (cachedClient) return cachedClient;
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return null;
  cachedClient = new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
    host: env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    // We don't load feature flags from the server runtime — analytics
    // only. Disable the periodic poller so we don't burn HTTP budget
    // on an unused subsystem.
    enableLocalEvaluation: false,
    flushAt: 1,
    flushInterval: 0,
    // Last-line PII scrub. Mirror of the client's `sanitize_properties`
    // hook, adapted for posthog-node's `before_send(event)` signature.
    // Returns `null` to drop the event only on internal contract
    // violations (no `event.event` name); otherwise mutates a copy of
    // `properties` and returns the modified event. See
    // `lib/analytics/sanitize.ts` for the layered defense rationale.
    before_send: (event) => {
      if (!event) return event;
      if (event.properties) {
        event.properties = sanitizeProperties(event.properties);
      }
      return event;
    },
  });
  return cachedClient;
}

/** Type-safe server emit. `distinctId` is required — pass the user id
 *  from `ctx.session.user.id`, or a `"system:<source>"` identity for
 *  unattributable events (webhook fans, cron jobs).
 *
 *  Returns a Promise so callers in Inngest jobs can `await` for
 *  delivery confirmation. tRPC mutations should NOT await — emit
 *  fire-and-forget so analytics never blocks the user response. */
export async function trackServer(
  distinctId: string,
  event: AnalyticsEvent,
): Promise<void> {
  const client = getClient();
  if (!client) return;
  if (!distinctId) return;

  const properties = event.properties as unknown as Record<string, unknown>;
  if (payloadHasPii(properties)) {
    handlePiiViolation("analytics-server", event.name, properties);
    return;
  }

  try {
    await client.captureImmediate({
      distinctId,
      event: event.name,
      properties,
    });
  } catch (err) {
    // Ingestion failures must never break the request that emitted
    // them. Log to Sentry with the event name (NOT the payload) and
    // swallow.
    Sentry.captureException(err, {
      tags: { source: "analytics-server", event: event.name },
    });
  }
}

/** Sync identify call. PostHog's server identify is a `set` on the
 *  user's person properties — typically called once on first sign-in
 *  to record stable attributes (provider, role). */
export async function identifyServer(
  distinctId: string,
  properties: Record<string, string | number | boolean>,
): Promise<void> {
  const client = getClient();
  if (!client) return;
  if (!distinctId) return;

  if (payloadHasPii(properties)) {
    handlePiiViolation("analytics-server", "identify", properties);
    return;
  }

  try {
    await client.identifyImmediate({ distinctId, properties });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { source: "analytics-server", event: "identify" },
    });
  }
}

/** Test helper — drops the cached singleton so a fresh client is built
 *  on the next call. Tests must call this in `afterEach` to avoid
 *  bleed between test files. NOT for production use. */
export function __resetAnalyticsClientForTests(): void {
  cachedClient = null;
}

