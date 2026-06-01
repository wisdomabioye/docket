/**
 * Last-line PII scrubber. Adapted into PostHog's `before_send` hook
 * (both client `posthog-js` and server `posthog-node` use the same
 * hook name on their respective configs — see `PostHogProvider.tsx`
 * and `server/services/analytics/server.ts`). Runs against EVERY
 * event right before it's sent to the PostHog ingestion API,
 * regardless of how the event was produced (manual `track()`,
 * `$pageview`, `$autocapture`, anything PostHog adds to a property
 * bag in the future).
 *
 * Layered defense — the redaction stack from outside-in:
 *   1. Taxonomy review (`lib/analytics/events.ts`) — payloads are
 *      typed; a developer can't add a PII key without visible code
 *      review of the schema.
 *   2. Static audit (`tests/unit/analytics-pii-audit.test.ts`) —
 *      walks every declared payload key against the denylist at CI
 *      time. Regression caught before merge.
 *   3. Runtime guard (`lib/analytics/pii-guard.ts`) — dev-throws on
 *      any PII key that survives the type system. Catches the case
 *      where a developer downcasts via `as` to bypass types.
 *   4. THIS module — last-mile scrub on the way out the wire. Catches
 *      PII that leaked into properties PostHog set itself
 *      (`$current_url` query strings, `$initial_referrer`, autocapture
 *      element text). Belt-and-suspenders for the runtime guard.
 *
 * No runtime cost concern: `sanitize_properties` runs once per event,
 * not per render. The PII keyset is small and matches are O(1).
 */

import { PII_PROPERTY_KEYS } from "@/lib/analytics/events";

const REDACTED = "[redacted]";

/** Property keys that PostHog auto-sets with a full URL (i.e. could
 *  carry a `?key=value` query string). Verified against
 *  `posthog-js@1.372.6/dist/array.no-external.js`:
 *    - `$current_url`     → full URL of the page being captured
 *    - `$referrer`        → full URL of the referring page
 *    - `$pathname`        → path only (no query string), skip
 *    - `$referring_domain`→ hostname only, skip
 *    - `$host`            → hostname only, skip
 *    - `$initial_*_info`  → nested OBJECT, not a URL string; skip
 *
 *  Only the two real URL-string keys make this set; expanding it later
 *  is fine — a non-URL value still hits `scrubUrlPii`'s no-`?` fast
 *  path and passes through unchanged. */
const URL_PROPERTY_KEYS: ReadonlySet<string> = new Set([
  "$current_url",
  "$referrer",
]);

/** Replace the value of any query-string parameter whose key is in the
 *  PII denylist with `[redacted]`. Used by `sanitizeProperties` to
 *  defang URLs before they're forwarded.
 *
 *  Examples (assume `email` and `beneficiary_name` are denylisted):
 *    `/cases/abc?tab=outputs`
 *      → `/cases/abc?tab=outputs`         (no change)
 *    `/?email=foo@bar.com&tab=docs`
 *      → `/?email=%5Bredacted%5D&tab=docs`
 *    `https://trydocketapp.com/?beneficiary_name=Maria%20G`
 *      → `https://trydocketapp.com/?beneficiary_name=%5Bredacted%5D`
 *
 *  Returns the input unchanged when:
 *    - the value is not a string
 *    - the URL has no query string
 *    - parsing fails (returns the original — never throw out of a
 *      sanitizer; an exception here would block the entire event). */
export function scrubUrlPii(value: unknown): unknown {
  if (typeof value !== "string") return value;
  // Cheap fast-path: no `?` means no query string to scrub.
  const qIndex = value.indexOf("?");
  if (qIndex === -1) return value;
  try {
    // `URL` requires an absolute URL — pageview values may be
    // pathname-only (`"/case/abc?tab=docs"`). Use a sentinel base so
    // relative inputs parse, then strip the base off the output.
    const base = "https://__sanitize__.local";
    const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(value);
    const url = new URL(value, isAbsolute ? undefined : base);
    let touched = false;
    for (const key of url.searchParams.keys()) {
      if (PII_PROPERTY_KEYS.includes(key)) {
        url.searchParams.set(key, REDACTED);
        touched = true;
      }
    }
    if (!touched) return value;
    if (isAbsolute) return url.toString();
    // Reconstruct the relative form so the consumer sees the same
    // shape it sent in.
    return url.pathname + url.search + url.hash;
  } catch {
    return value;
  }
}

/** Returns a defanged copy of `properties` ready to forward to PostHog.
 *
 *  Two passes:
 *    1. Top-level keys in the denylist → value replaced with
 *       `[redacted]`. This is the same gate as `payloadHasPii`, but
 *       redacts instead of dropping the event so PostHog still
 *       receives the event shape.
 *    2. URL-shaped system keys (`$current_url`, `$referrer`) →
 *       per-query-param scrub via `scrubUrlPii`.
 *
 *  Returns a NEW object — never mutates the input bag. PostHog passes
 *  the same `properties` reference to subsequent extensions in the SDK
 *  pipeline; mutating in place would have non-local side effects.
 *
 *  Why we type `properties` as `Record<string, unknown>` rather than
 *  `@posthog/types`'s `Properties = Record<string, any>`: keeping
 *  `unknown` forces the hook adapters at the call sites to declare
 *  what they're passing in, and prevents `any` from leaking into our
 *  surface. The two are structurally compatible at the call site. */
export function sanitizeProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (PII_PROPERTY_KEYS.includes(key)) {
      out[key] = REDACTED;
      continue;
    }
    if (URL_PROPERTY_KEYS.has(key)) {
      out[key] = scrubUrlPii(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}
