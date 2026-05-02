"use client";

/**
 * PostHog browser wrapper. The single allowed entry point for emitting
 * product-analytics events from a Client Component.
 *
 * Why a wrapper instead of importing `posthog-js` directly at call sites:
 *  1. Type safety — `track()` accepts only events declared in
 *     `lib/analytics/events.ts`. A typo in the event name is a compile
 *     error, not a silently-dropped event in production.
 *  2. PII discipline — every payload is screened against
 *     `payloadHasPii()` before reaching PostHog. In dev the violation
 *     throws (loud, fast feedback); in prod it logs to Sentry and
 *     silently drops the event so a bad code path can't leak data.
 *  3. Init-safety — calls before `posthog.init()` (e.g. early
 *     mount, missing env var) are a no-op rather than an exception.
 *  4. Future swap — if we ever move off PostHog, only this file
 *     changes. Call sites stay put.
 *
 * Init is performed by `<PostHogProvider/>` (PH.5) on first mount of
 * the authenticated layout. This file does NOT call `posthog.init()` —
 * keeping init in the provider keeps the dependency one-way (provider
 * → wrapper → posthog-js).
 */

import posthog from "posthog-js";
import { type AnalyticsEvent, payloadHasPii } from "@/lib/analytics/events";
import { handlePiiViolation } from "@/lib/analytics/pii-guard";

/** Returns true once `posthog.init()` has run. PostHog's `__loaded`
 *  flag is the documented init sentinel and is `false` (not undefined)
 *  before init, so a strict equality check is safe. */
function isInitialized(): boolean {
  return posthog.__loaded === true;
}

/** Type-safe emit. Use at any client call site:
 *
 *  ```ts
 *  track({ name: "case.created", properties: { case_id, visa_type } });
 *  ```
 *
 *  No-op when PostHog is not initialized (missing env var, SSR, before
 *  provider mount). Drops events whose payload contains a PII key —
 *  see `lib/analytics/events.ts:PII_PROPERTY_KEYS`. */
export function track(event: AnalyticsEvent): void {
  if (!isInitialized()) return;

  // Cast to Record for the audit — the discriminated-union type already
  // narrows the keys, so this is a structural identity, not a widening.
  const properties = event.properties as unknown as Record<string, unknown>;
  if (payloadHasPii(properties)) {
    handlePiiViolation("analytics-client", event.name, properties);
    return;
  }

  posthog.capture(event.name, properties);
}

/** Associate the current browser session with an authenticated user.
 *  Call once per sign-in, after the session is confirmed. PostHog
 *  merges anonymous events captured before this call into the same
 *  user profile via `$anon_distinct_id`. */
export function identify(userId: string): void {
  if (!isInitialized()) return;
  if (!userId) return;
  posthog.identify(userId);
}

/** Drop the current user association. Call on sign-out so subsequent
 *  events are anonymous and not attributed to the previous user. */
export function reset(): void {
  if (!isInitialized()) return;
  posthog.reset();
}

/** Emit a manual page view. Use only when a route change happens
 *  *without* a real navigation (e.g. tab switching that mutates URL
 *  params). The provider auto-captures real navigations via the
 *  `usePathname` effect — do not double-fire. */
export function capturePageview(url: string): void {
  if (!isInitialized()) return;
  posthog.capture("$pageview", { $current_url: url });
}

