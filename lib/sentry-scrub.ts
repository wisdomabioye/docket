import type {
  Breadcrumb,
  BreadcrumbHint,
  ErrorEvent,
  EventHint,
} from "@sentry/nextjs";

/**
 * PII scrubbing for Sentry events. Per spec §17, the following keys must
 * never reach Sentry — they identify beneficiaries or contain
 * client-confidential evidence content. The `beforeSend` /
 * `beforeBreadcrumb` hooks in `sentry.{server,edge}.config.ts` and
 * `instrumentation-client.ts` apply this scrubber.
 *
 * Matching is case-insensitive and accepts both snake_case and
 * camelCase forms (the same field appears under both spellings across
 * Drizzle row types and Zod schemas).
 *
 * Why a custom scrubber rather than Sentry's built-in `denyUrls` /
 * `ignoreErrors`: those filter ENTIRE events; we want to keep the event
 * (for stack-trace value) but redact specific values. Sentry's
 * `Replay`/`maskAllText` covers session replays, not error payloads.
 */

export const PII_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  /^email$/i,
  /^full_?name$/i,
  /^beneficiary_?name$/i,
  /^extracted_?text$/i,
  /^content$/i,
];

const REDACTED = "[redacted]";

function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERNS.some((re) => re.test(key));
}

/** Recursively walks `value`, returning a copy with PII keys replaced
 *  by `[redacted]`. Cycles are bounded by `depth`; arrays/objects are
 *  cloned (never mutate the caller's data). Primitives pass through. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return value; // bound the walk; deep events get truncated upstream
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isPiiKey(k) ? REDACTED : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Sentry `beforeSend` callback. Scrubs PII from error events before
 *  they leave the process. Returning `null` would drop the event;
 *  always return the (mutated) event so stack traces still report.
 *
 *  Field reassignments use `as never` to bypass `exactOptionalPropertyTypes`
 *  — Sentry's types declare these fields as non-optional even though they
 *  arrive as `undefined` for events that lack them, so a clean reassign
 *  is safe but TS can't see that here. */
export function scrubEvent(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  void hint;
  // Top-level fields Sentry exposes for user data + request data — the
  // most common landing spot for PII keys.
  if (event.request) {
    event.request = scrubValue(event.request) as never;
  }
  if (event.user) {
    event.user = scrubValue(event.user) as never;
  }
  if (event.extra) {
    event.extra = scrubValue(event.extra) as never;
  }
  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as never;
  }
  if (event.tags) {
    event.tags = scrubValue(event.tags) as never;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(
      (b) => scrubValue(b) as Breadcrumb,
    );
  }
  // Also walk `event.exception` — captures stack-frame `vars`
  // (local-scope variable values at throw time) and `mechanism.data`
  // (arbitrary attributes Sentry's auto-instrumentation attaches, e.g.
  // request URLs with query params). The error `value` (message) is a
  // string, so it passes through unchanged unless a parent key on the
  // exception object matches PII patterns.
  if (event.exception) {
    event.exception = scrubValue(event.exception) as never;
  }
  return event;
}

/** Sentry `beforeBreadcrumb` callback. Scrubs PII from breadcrumb data
 *  before it's recorded to the in-memory ring buffer (so even local
 *  breadcrumb inspection can't reveal PII). */
export function scrubBreadcrumb(
  breadcrumb: Breadcrumb,
  hint?: BreadcrumbHint,
): Breadcrumb | null {
  void hint;
  return scrubValue(breadcrumb) as Breadcrumb;
}
