import "server-only";
import { inngest } from "@/server/jobs/client";
import { sendEmail } from "@/server/services/email";
import { caseBuildFailedEvent } from "@/server/jobs/case-build-failed";
import { caseUrl, resolveCaseRecipient } from "./recipient";

/**
 * `case/build.failed` listener — emits the case-build-failed email.
 * Replaces the Stage 9 logging stub at `server/jobs/case-build-failed.ts`.
 *
 * The orchestrator's `onFailure` handler emits this event for any
 * fatal-path failure (evidence-plan crash, every fan-out failed,
 * watchdog kill). The `reason` payload field is a short tag suitable
 * for an email body line — the listener passes it through verbatim
 * rather than coining its own copy, since the orchestrator already
 * picked the most accurate phrasing.
 */
export const caseBuildFailedNotification = inngest.createFunction(
  {
    id: "notification-case-build-failed",
    concurrency: { key: "event.data.caseId", limit: 1 },
    retries: 2,
    triggers: [{ event: caseBuildFailedEvent }],
  },
  async ({ event, step }) => {
    const { caseId, reason } = event.data;

    const recipient = await step.run("resolve-recipient", async () =>
      resolveCaseRecipient(caseId),
    );
    if (!recipient) {
      console.info("[notification.case.build_failed] no recipient", { caseId });
      return { delivered: "skipped" as const, reason: "no recipient" };
    }

    const result = await step.run("send", async () =>
      sendEmail({
        to: recipient.email,
        email: {
          name: "case.build_failed",
          props: {
            attorneyName: recipient.name,
            caseLabel: recipient.caseLabel,
            reason,
            caseUrl: caseUrl(caseId),
          },
        },
      }),
    );
    if (result.delivered === "failed") {
      throw new Error(`case.build_failed send failed: ${result.error}`);
    }
    return result;
  },
);
