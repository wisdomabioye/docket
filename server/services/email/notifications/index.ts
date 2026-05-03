import "server-only";
import type { InngestFunction } from "inngest";

import { signupWelcomeNotification } from "./signup-welcome";
import { caseBuildStartedNotification } from "./case-build-started";
import { caseBuildCompletedNotification } from "./case-build-completed";
import { caseBuildFailedNotification } from "./case-build-failed";
import { caseArchivedNotification } from "./case-archived";
import { outputApprovedNotification } from "./output-approved";
import { packageReadyNotification } from "./package-ready";
import { adminInviteNotification } from "./admin-invite";

/**
 * One array of every notification listener. The Inngest function
 * registry (`server/jobs/index.ts`) spreads this in. Adding a new
 * notification = one entry here, no edit to the registry.
 */
export const notificationFunctions: ReadonlyArray<InngestFunction.Any> = [
  signupWelcomeNotification,
  caseBuildStartedNotification,
  caseBuildCompletedNotification,
  caseBuildFailedNotification,
  caseArchivedNotification,
  outputApprovedNotification,
  packageReadyNotification,
  adminInviteNotification,
];

export {
  signupWelcomeEvent,
  caseBuildStartedNotificationEvent,
  caseArchivedNotificationEvent,
  outputApprovedNotificationEvent,
  packageReadyNotificationEvent,
  adminInviteNotificationEvent,
} from "./events";
