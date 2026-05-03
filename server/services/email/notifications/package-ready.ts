import "server-only";
import { inngest } from "@/server/jobs/client";
import { sendEmail } from "@/server/services/email";
import { packageReadyNotificationEvent } from "./events";
import {
  casePackageUrl,
  countApprovedOutputs,
  resolveCaseRecipient,
} from "./recipient";

/**
 * `notification/package.ready` listener. Emitted by the package-compile
 * job once the PDF is rendered to storage. Re-counts approved outputs at
 * send time (cheap query, single index lookup) so the email reflects the
 * exact contents of the package the attorney is about to download — even
 * if the count drifted between compile-start and email-send (regen,
 * un-approve).
 */
export const packageReadyNotification = inngest.createFunction(
  {
    id: "notification-package-ready",
    concurrency: { key: "event.data.caseId", limit: 1 },
    retries: 2,
    triggers: [{ event: packageReadyNotificationEvent }],
  },
  async ({ event, step }) => {
    const { caseId } = event.data;

    const recipient = await step.run("resolve-recipient", async () =>
      resolveCaseRecipient(caseId),
    );
    if (!recipient) {
      console.info("[notification.package.ready] no recipient", { caseId });
      return { delivered: "skipped" as const, reason: "no recipient" };
    }

    const outputCount = await step.run("count-approved", async () =>
      countApprovedOutputs(caseId),
    );

    const result = await step.run("send", async () =>
      sendEmail({
        to: recipient.email,
        email: {
          name: "package.ready",
          props: {
            attorneyName: recipient.name,
            caseLabel: recipient.caseLabel,
            outputCount,
            packageUrl: casePackageUrl(caseId),
          },
        },
      }),
    );
    if (result.delivered === "failed") {
      throw new Error(`package.ready send failed: ${result.error}`);
    }
    return result;
  },
);
