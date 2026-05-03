import { describe, expect, it } from "vitest";
import {
  notificationFunctions,
} from "@/server/services/email/notifications";
import {
  signupWelcomeEvent,
  caseBuildStartedNotificationEvent,
  caseArchivedNotificationEvent,
  outputApprovedNotificationEvent,
  packageReadyNotificationEvent,
  adminInviteNotificationEvent,
} from "@/server/services/email/notifications/events";
import { caseBuildFailedEvent } from "@/server/jobs/case-build-failed";
import { caseBuildCompletedEvent } from "@/server/jobs/case-build";

/**
 * Notification fan-out — wiring guard. The behavior of each listener
 * (resolve recipient → render → call sendEmail) is exercised by the
 * email-service + recipient unit tests plus the integration suite. The
 * value here is locking the *connections*: every listener subscribes
 * to the right event, and the registry exposes exactly the eight
 * functions PM.4 declared. A drift in either silently disconnects an
 * email path in production with no test failure to catch it.
 *
 * Two non-trivial decisions this test pins:
 *   - case.build_completed and case.build_failed listeners subscribe
 *     to the existing DOMAIN events (`case/build.completed`,
 *     `case/build.failed`) — NOT a separate `notification/...` event.
 *   - The other six subscribe to dedicated `notification/...` events
 *     emitted by mutations + jobs in PM.5.
 */

const EXPECTED: Record<string, string> = {
  "notification-signup-welcome": signupWelcomeEvent.name,
  "notification-case-build-started": caseBuildStartedNotificationEvent.name,
  "notification-case-build-completed": caseBuildCompletedEvent.name,
  "notification-case-build-failed": caseBuildFailedEvent.name,
  "notification-case-archived": caseArchivedNotificationEvent.name,
  "notification-output-approved": outputApprovedNotificationEvent.name,
  "notification-package-ready": packageReadyNotificationEvent.name,
  "notification-admin-invite": adminInviteNotificationEvent.name,
};

describe("notificationFunctions registry", () => {
  it("exposes exactly the eight PM.4 listeners", () => {
    const ids = notificationFunctions.map((f) => f.id()).sort();
    expect(ids).toEqual(Object.keys(EXPECTED).sort());
  });

  it("each listener id matches the kebab-case naming convention", () => {
    for (const fn of notificationFunctions) {
      expect(fn.id()).toMatch(/^notification-[a-z0-9-]+$/);
    }
  });

  it("each listener subscribes to its expected trigger event", () => {
    // The Inngest function exposes `triggers` as part of its options.
    // A typed accessor doesn't exist on the public surface, so we read
    // the field reflectively — a rename inside Inngest would surface
    // here as a TypeError, which is preferable to a silent miss.
    for (const fn of notificationFunctions) {
      const id = fn.id();
      const expectedEvent = EXPECTED[id];
      expect(expectedEvent, `unknown listener id ${id}`).toBeDefined();

      const triggers = (fn as unknown as {
        opts: { triggers?: ReadonlyArray<{ event?: { name?: string } | string }> };
      }).opts.triggers;
      expect(triggers, `listener ${id} has no triggers`).toBeDefined();
      expect(triggers!.length).toBeGreaterThan(0);

      const trigger = triggers![0]!;
      const eventField = trigger.event;
      const eventName =
        typeof eventField === "string" ? eventField : eventField?.name;
      expect(eventName).toBe(expectedEvent);
    }
  });
});

describe("notification event identities", () => {
  it("uses canonical, namespaced event names", () => {
    expect(signupWelcomeEvent.name).toBe("notification/signup.welcome");
    expect(caseBuildStartedNotificationEvent.name).toBe(
      "notification/case.build_started",
    );
    expect(caseArchivedNotificationEvent.name).toBe("notification/case.archived");
    expect(outputApprovedNotificationEvent.name).toBe(
      "notification/output.approved",
    );
    expect(packageReadyNotificationEvent.name).toBe(
      "notification/package.ready",
    );
    expect(adminInviteNotificationEvent.name).toBe("notification/admin.invite");
  });

  it("re-uses the domain events for build-completed + build-failed listeners", () => {
    // No separate `notification/case.build_completed` event exists —
    // the listener subscribes directly to the orchestrator's domain
    // event so the email fires off the same source-of-truth as the
    // status transition.
    expect(caseBuildCompletedEvent.name).toBe("case/build.completed");
    expect(caseBuildFailedEvent.name).toBe("case/build.failed");
  });
});
