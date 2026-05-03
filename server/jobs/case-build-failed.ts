import "server-only";
import { eventType, staticSchema } from "inngest";

/**
 * `case/build.failed` event definition. The parent `case-build`
 * orchestrator (Phase 10) emits this whenever the pipeline can't
 * recover (evidence-plan crash, every fan-out failed, or the watchdog
 * killed a stuck build).
 *
 * Stage 11 / PM.4 replaced the prior logging-only listener with the
 * notification fan-out at
 * `server/services/email/notifications/case-build-failed.ts` — that
 * function consumes this event and ships the email to the case's
 * primary attorney. The event type stays here so the orchestrator and
 * the notifier import from the same source of truth.
 */

export const caseBuildFailedEvent = eventType("case/build.failed", {
  schema: staticSchema<{
    caseId: string;
    /** Short tag suitable for an email subject line ("budget exceeded",
     *  "computer unreachable", etc.) — not free-form user content. */
    reason: string;
    /** User who triggered the build, OR the literal `"system"` when the
     *  watchdog killed it. The notifier ignores this for now (always
     *  routes to the primary attorney) but it lets a future audit log
     *  attribute the failure to the original click. */
    requestedBy: string;
  }>(),
});
