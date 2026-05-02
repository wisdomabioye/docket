/**
 * Shared PII-violation handler used by both the client and server
 * analytics wrappers. Single source of truth for the dev-throws /
 * prod-Sentry-and-drop policy.
 *
 * Why isomorphic: `@sentry/nextjs` exports the same `captureMessage`
 * surface for both runtimes; the analytics wrappers want identical
 * failure semantics on either side. Centralising here means a future
 * policy change (e.g. tightening to fail in prod) lands in one file.
 *
 * No `server-only` import — this module is reachable from both
 * `lib/analytics/client.ts` (client bundle) and
 * `server/services/analytics/server.ts` (server bundle).
 */

import * as Sentry from "@sentry/nextjs";
import { payloadHasPii } from "@/lib/analytics/events";

/** Source tag — distinguishes which wrapper raised the alarm in Sentry. */
export type PiiViolationSource = "analytics-client" | "analytics-server";

export function handlePiiViolation(
  source: PiiViolationSource,
  /** Event name string. Accepts `string` (not `EventName`) so the
   *  identify path — which has no `EventName` — can route through here too. */
  eventName: string,
  properties: Record<string, unknown>,
): void {
  const offendingKeys = Object.keys(properties).filter((k) =>
    payloadHasPii({ [k]: properties[k] }),
  );
  const message = `[${source}] PII key(s) in payload for event "${eventName}": ${offendingKeys.join(", ")}`;

  if (process.env.NODE_ENV !== "production") {
    throw new Error(message);
  }
  Sentry.captureMessage(message, {
    level: "error",
    tags: { source: `${source}-pii-guard`, event: eventName },
  });
}
