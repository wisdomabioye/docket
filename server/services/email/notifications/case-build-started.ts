import "server-only";
import { inngest } from "@/server/jobs/client";
import { sendEmail } from "@/server/services/email";
import { caseBuildStartedNotificationEvent } from "./events";
import { caseUrl, resolveCaseRecipient } from "./recipient";

/**
 * `notification/case.build_started` listener. Emitted by the
 * `case.requestBuild` mutation (PM.5) the moment the user clicks Build
 * — a separate notification event from the orchestrator's
 * `case/build.requested`, because the mutation has the doc-count
 * context to compute `etaMinutes` and the orchestrator runs against
 * Inngest infra that we don't want coupled to the user-visible ETA.
 */
export const caseBuildStartedNotification = inngest.createFunction(
  {
    id: "notification-case-build-started",
    concurrency: { key: "event.data.caseId", limit: 1 },
    retries: 2,
    triggers: [{ event: caseBuildStartedNotificationEvent }],
  },
  async ({ event, step }) => {
    const { caseId, etaMinutes } = event.data;

    const recipient = await step.run("resolve-recipient", async () =>
      resolveCaseRecipient(caseId),
    );
    if (!recipient) {
      console.info("[notification.case.build_started] no recipient", { caseId });
      return { delivered: "skipped" as const, reason: "no recipient" };
    }

    const result = await step.run("send", async () =>
      sendEmail({
        to: recipient.email,
        email: {
          name: "case.build_started",
          props: {
            attorneyName: recipient.name,
            caseLabel: recipient.caseLabel,
            etaMinutes,
            caseUrl: caseUrl(caseId),
          },
        },
      }),
    );
    if (result.delivered === "failed") {
      throw new Error(`case.build_started send failed: ${result.error}`);
    }
    return result;
  },
);
