import "server-only";

/**
 * Convenience wrappers around `trackServer()` for the two common
 * call-site shapes in the codebase:
 *   - `emitFromCtx(ctx, event)` — tRPC mutation that already has a
 *     resolved `ctx.user.id`. Fire-and-forget (no await) so
 *     analytics latency / failure never blocks the user response.
 *   - `emitFromUser(userId, event)` — Inngest jobs and webhook
 *     handlers that have a user id from the event payload but no
 *     `ctx`. Returns the promise so callers can `await` if they care
 *     about delivery confirmation; default is fire-and-forget.
 *
 * Why both:
 *   - Calling `trackServer(ctx.user.id, event)` directly at every tRPC
 *     emit site forces the same `?? "system"` fallback to be repeated
 *     14 times. The helper centralises the "if no user id, route as
 *     system event" decision.
 *   - The fire-and-forget `void` discards the Promise so a
 *     `noFloatingPromises` lint stays clean without each call site
 *     having to remember the `void` keyword.
 */

import type { TrpcContext } from "@/server/api/trpc";
import type { AnalyticsEvent } from "@/lib/analytics/events";
import { trackServer } from "@/server/services/analytics/server";

/** Emit from a tRPC mutation. Fire-and-forget — analytics failures
 *  must not surface to the caller. Routes anonymous events (rare —
 *  only `publicProcedure` mutations) under a stable `"system:trpc"`
 *  distinct id so they're still visible in PostHog. */
export function emitFromCtx(ctx: TrpcContext, event: AnalyticsEvent): void {
  const distinctId = ctx.user?.id ?? "system:trpc";
  void trackServer(distinctId, event);
}

/** Emit from a non-tRPC server context (Inngest, webhook). Returns the
 *  Promise so jobs that want delivery confirmation can `await` it.
 *  Default convention: fire-and-forget like `emitFromCtx`. */
export function emitFromUser(
  userId: string | null | undefined,
  event: AnalyticsEvent,
): Promise<void> {
  return trackServer(userId ?? "system:job", event);
}
