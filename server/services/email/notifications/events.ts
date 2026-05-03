import "server-only";
import { eventType, staticSchema } from "inngest";

/**
 * Inngest event definitions for the six notification kinds that don't
 * already have a domain event.
 *
 *   - `case/build.completed` and `case/build.failed` are emitted by the
 *     `case-build` orchestrator (`server/jobs/case-build.ts`) and re-used
 *     here as listener triggers — no separate notification event for
 *     those two.
 *   - The six below are dedicated `notification/*` events. Mutations and
 *     other jobs (PM.5) emit them via `inngest.send(...)`; the listeners
 *     in this directory are the only consumers.
 *
 * Payload shape principle: carry the minimum identifiers; the listener
 * does the DB resolution. Two reasons —
 *   1. Recipient resolution policy (primary attorney lookup, name
 *      coalescing) lives next to the email, not at every emit site.
 *   2. Events stored in Inngest's history don't carry stale denormalized
 *      data (an attorney rename between emit and consume still resolves
 *      to the current name).
 */

export const signupWelcomeEvent = eventType("notification/signup.welcome", {
  schema: staticSchema<{
    /** Newly created user. The listener loads name + email by id. */
    userId: string;
  }>(),
});

export const caseBuildStartedNotificationEvent = eventType(
  "notification/case.build_started",
  {
    schema: staticSchema<{
      caseId: string;
      /** Best-effort ETA. Computed at the emit site (it's a function of
       *  document count + visa type, both of which the emit site already
       *  has). Listener treats this as opaque copy. */
      etaMinutes: number;
    }>(),
  },
);

export const caseArchivedNotificationEvent = eventType(
  "notification/case.archived",
  {
    schema: staticSchema<{
      caseId: string;
      /** ISO 8601 UTC. Stamped at the moment of archive — passed through
       *  to the email body so a delayed delivery still shows the correct
       *  archive time, not the send time. */
      archivedAt: string;
    }>(),
  },
);

export const outputApprovedNotificationEvent = eventType(
  "notification/output.approved",
  {
    schema: staticSchema<{
      caseId: string;
      outputId: string;
    }>(),
  },
);

export const packageReadyNotificationEvent = eventType(
  "notification/package.ready",
  {
    schema: staticSchema<{
      caseId: string;
    }>(),
  },
);

export const adminInviteNotificationEvent = eventType(
  "notification/admin.invite",
  {
    schema: staticSchema<{
      /** Invitee's email address — recipient of the email AND the lookup
       *  key when they later sign in (auth invite-gate matches on email). */
      inviteeEmail: string;
      /** Display name from the invite form. Falls back to the email's
       *  local-part inside the listener if blank. */
      inviteeName: string;
      /** User who issued the invite. Listener loads name by id; left
       *  optional because the bootstrap admin invite (auto-issued on
       *  first signup) has no inviter user yet. */
      invitedByUserId: string | null;
    }>(),
  },
);
