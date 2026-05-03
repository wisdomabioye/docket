import "server-only";
import { inngest } from "@/server/jobs/client";
import { sendEmail } from "@/server/services/email";
import { caseArchivedNotificationEvent } from "./events";
import { resolveCaseRecipient } from "./recipient";

/**
 * `notification/case.archived` listener. Emitted by the case-archive
 * mutation (PM.5). Carries `archivedAt` so the body shows the time the
 * archive actually happened, not the email-send time (which can drift
 * if the worker is delayed).
 */
export const caseArchivedNotification = inngest.createFunction(
  {
    id: "notification-case-archived",
    concurrency: { key: "event.data.caseId", limit: 1 },
    retries: 2,
    triggers: [{ event: caseArchivedNotificationEvent }],
  },
  async ({ event, step }) => {
    const { caseId, archivedAt } = event.data;

    const recipient = await step.run("resolve-recipient", async () =>
      resolveCaseRecipient(caseId),
    );
    if (!recipient) {
      console.info("[notification.case.archived] no recipient", { caseId });
      return { delivered: "skipped" as const, reason: "no recipient" };
    }

    const result = await step.run("send", async () =>
      sendEmail({
        to: recipient.email,
        email: {
          name: "case.archived",
          props: {
            attorneyName: recipient.name,
            caseLabel: recipient.caseLabel,
            archivedAt,
          },
        },
      }),
    );
    if (result.delivered === "failed") {
      throw new Error(`case.archived send failed: ${result.error}`);
    }
    return result;
  },
);
