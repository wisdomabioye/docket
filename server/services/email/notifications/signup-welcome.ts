import "server-only";
import { inngest } from "@/server/jobs/client";
import { sendEmail } from "@/server/services/email";
import { signupWelcomeEvent } from "./events";
import { dashboardUrl, resolveUserRecipient } from "./recipient";

/**
 * `notification/signup.welcome` listener. Fires once when an attorney
 * completes their first sign-in and the auth onboarding hook (Stage 02)
 * promotes them to an active workspace.
 *
 * Idempotency: a single user gets exactly one welcome email. Inngest's
 * `step.run` plus the `userId`-keyed concurrency lock prevents a double-
 * delivery if the upstream emit happens twice (e.g. retried mutation).
 *
 * Failure policy: a delivery failure rethrows so Inngest's automatic
 * retry kicks in. The wrapper service has already converted Postmark
 * errors into a non-throwing envelope; we re-throw on `failed` only —
 * `not_configured` (no Postmark API key) is a clean dev/CI no-op and
 * exits successfully.
 */
export const signupWelcomeNotification = inngest.createFunction(
  {
    id: "notification-signup-welcome",
    concurrency: { key: "event.data.userId", limit: 1 },
    retries: 2,
    triggers: [{ event: signupWelcomeEvent }],
  },
  async ({ event, step }) => {
    const { userId } = event.data;

    const recipient = await step.run("resolve-recipient", async () =>
      resolveUserRecipient(userId),
    );
    if (!recipient) {
      // Don't throw — a missing user is a data state, not a transient
      // failure. Logging at info because the most common cause is a
      // soft-deleted user (race with sign-out).
      console.info("[notification.signup.welcome] no recipient", { userId });
      return { delivered: "skipped" as const, reason: "no recipient" };
    }

    const result = await step.run("send", async () =>
      sendEmail({
        to: recipient.email,
        email: {
          name: "signup.welcome",
          props: {
            attorneyName: recipient.name,
            dashboardUrl: dashboardUrl(),
          },
        },
      }),
    );
    if (result.delivered === "failed") {
      throw new Error(`signup.welcome send failed: ${result.error}`);
    }
    return result;
  },
);
