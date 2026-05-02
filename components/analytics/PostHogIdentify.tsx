"use client";

/**
 * Identify the current PostHog browser session against the
 * authenticated user id. Renders nothing.
 *
 * Mounted inside `app/(app)/(workspace)/layout.tsx` (server component)
 * which knows `session.user.id` from `auth()`. The user id is passed
 * down as a prop, so this component itself never reaches into Auth.js
 * — it only owns the side-effect of calling `posthog.identify()` at
 * the right moment.
 *
 * Idempotency: re-mounting on every layout render would re-call
 * `identify()`, which is technically idempotent on PostHog's side but
 * fires a network request each time. Effect deps gate it to a real
 * change in `userId`, so a normal re-render does nothing.
 *
 * Sign-out is handled by the wrapper's `reset()` exported from
 * `lib/analytics/client.ts` — wired by the sign-out form (PH.6),
 * not here.
 */

import { useEffect } from "react";
import { identify } from "@/lib/analytics/client";

export function PostHogIdentify({
  userId,
}: {
  userId: string;
}): null {
  useEffect(() => {
    if (!userId) return;
    identify(userId);
  }, [userId]);
  return null;
}
