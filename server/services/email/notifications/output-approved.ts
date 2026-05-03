import "server-only";
import { inngest } from "@/server/jobs/client";
import { sendEmail } from "@/server/services/email";
import { outputApprovedNotificationEvent } from "./events";
import {
  outputUrl,
  resolveCaseRecipient,
  resolveOutputLabel,
} from "./recipient";

/**
 * `notification/output.approved` listener. Emitted by the output-approve
 * mutation (PM.5). Resolves the output's display label inside the
 * listener so a rename of the output title between approve and send
 * doesn't ship stale copy.
 */
export const outputApprovedNotification = inngest.createFunction(
  {
    id: "notification-output-approved",
    concurrency: { key: "event.data.outputId", limit: 1 },
    retries: 2,
    triggers: [{ event: outputApprovedNotificationEvent }],
  },
  async ({ event, step }) => {
    const { caseId, outputId } = event.data;

    const recipient = await step.run("resolve-recipient", async () =>
      resolveCaseRecipient(caseId),
    );
    if (!recipient) {
      console.info("[notification.output.approved] no recipient", { caseId });
      return { delivered: "skipped" as const, reason: "no recipient" };
    }

    const outputLabel = await step.run("resolve-output-label", async () =>
      resolveOutputLabel({ caseId, outputId }),
    );
    if (!outputLabel) {
      console.info("[notification.output.approved] no output", {
        caseId,
        outputId,
      });
      return { delivered: "skipped" as const, reason: "no output" };
    }

    const result = await step.run("send", async () =>
      sendEmail({
        to: recipient.email,
        email: {
          name: "output.approved",
          props: {
            attorneyName: recipient.name,
            caseLabel: recipient.caseLabel,
            outputLabel,
            outputUrl: outputUrl(caseId, outputId),
          },
        },
      }),
    );
    if (result.delivered === "failed") {
      throw new Error(`output.approved send failed: ${result.error}`);
    }
    return result;
  },
);
