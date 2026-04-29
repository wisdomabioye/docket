import "server-only";
import { eventType, staticSchema } from "inngest";
import { inngest } from "./client";

/**
 * `case/build.failed` listener. Phase 9 ships a logging-only stub —
 * Stage 11 (notifications) replaces the body with a Postmark email to
 * the case's primary attorney + an admin Slack ping.
 *
 * The parent `case-build` orchestrator (Phase 10) emits this event when
 * the pipeline can't recover (every output failed, or the case row was
 * deleted mid-build, or the budget guard hit before any output saved).
 * `caseId` lets the eventual notifier look up recipients; `reason` is a
 * short tag suitable for an email subject line ("budget exceeded",
 * "computer unreachable", etc.).
 */

export const caseBuildFailedEvent = eventType("case/build.failed", {
  schema: staticSchema<{
    caseId: string;
    reason: string;
    /** User who triggered the build, OR the literal `"system"` when the
     *  watchdog killed it. The notifier picks the email recipient with
     *  this hint. */
    requestedBy: string;
  }>(),
});

export const caseBuildFailed = inngest.createFunction(
  {
    id: "case-build-failed",
    // Don't fan out per-case here — one alert per failure event is
    // correct, no concurrency key needed.
    retries: 1,
    triggers: [{ event: caseBuildFailedEvent }],
  },
  async ({ event, step }) => {
    await step.run("log", async () => {
      // Structured log — Sentry breadcrumbs + stage-11 notifier consume
      // the same fields. No PII (caseId is opaque uuid; `reason` is a
      // template tag, not user content).
      console.warn("[case-build-failed]", {
        caseId: event.data.caseId,
        reason: event.data.reason,
        eventId: event.id,
        eventTs: event.ts,
      });
    });
    // TODO(stage-11): send Postmark email + admin Slack ping.
    return { acknowledged: true };
  },
);
