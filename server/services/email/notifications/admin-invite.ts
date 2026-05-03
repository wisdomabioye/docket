import "server-only";
import { inngest } from "@/server/jobs/client";
import { sendEmail } from "@/server/services/email";
import { adminInviteNotificationEvent } from "./events";
import {
  nameOrLocalPart,
  resolveUserRecipient,
  signInUrl,
} from "./recipient";

/**
 * `notification/admin.invite` listener. Emitted by the admin invite
 * mutation (PM.5). Two unusual properties vs the other notifiers:
 *
 *   - The recipient is identified by email (not user id). The invitee
 *     may not exist in `users` yet — the invite-gate creates the row
 *     on first SSO sign-in.
 *   - The inviter user id is optional: the bootstrap admin invite
 *     (auto-issued at the very first signup) has no inviter and falls
 *     back to "the Docket team" copy.
 */
export const adminInviteNotification = inngest.createFunction(
  {
    id: "notification-admin-invite",
    concurrency: { key: "event.data.inviteeEmail", limit: 1 },
    retries: 2,
    triggers: [{ event: adminInviteNotificationEvent }],
  },
  async ({ event, step }) => {
    const { inviteeEmail, inviteeName, invitedByUserId } = event.data;

    const inviter = invitedByUserId
      ? await step.run("resolve-inviter", async () =>
          resolveUserRecipient(invitedByUserId),
        )
      : null;

    const inviterName = inviter?.name ?? "The Docket team";
    const recipientName = nameOrLocalPart(inviteeName, inviteeEmail);

    const result = await step.run("send", async () =>
      sendEmail({
        to: inviteeEmail,
        email: {
          name: "admin.invite",
          props: {
            recipientName,
            invitedBy: inviterName,
            signInUrl: signInUrl(),
          },
        },
      }),
    );
    if (result.delivered === "failed") {
      throw new Error(`admin.invite send failed: ${result.error}`);
    }
    return result;
  },
);
