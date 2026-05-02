// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/analytics/pii-guard.ts` — shared dev-throws / prod-Sentry-and-drop
 * policy used by both the client wrapper (`lib/analytics/client.ts`) and
 * the server wrapper (`server/services/analytics/server.ts`).
 *
 * Why a focused test: the dev/prod branching logic is invisible in
 * production logs (Sentry receives the violation, but a developer
 * reading the code later can't tell whether the prod path will ever
 * actually fire). Tests pin both branches.
 *
 * Strategy: mock `@sentry/nextjs` so `captureMessage` becomes a spy.
 * Toggle NODE_ENV via `vi.stubEnv` per test; the guard reads it inline.
 */

const sentryMock = vi.hoisted(() => ({
  captureMessage: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentryMock);

import { handlePiiViolation } from "@/lib/analytics/pii-guard";

beforeEach(() => {
  sentryMock.captureMessage.mockReset();
});

afterEach(() => {
  // Restore the real NODE_ENV between tests. `vi.stubEnv` is the
  // vitest-supported way to mutate process.env when @types/node
  // marks the slot readonly (Node 22+).
  vi.unstubAllEnvs();
});

describe("handlePiiViolation — dev branch", () => {
  it("throws a descriptive Error when NODE_ENV !== production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() =>
      handlePiiViolation("analytics-client", "case.created", {
        case_id: "abc",
        email: "leaked@example.com",
      }),
    ).toThrowError(
      /\[analytics-client\] PII key\(s\) in payload for event "case\.created": email/,
    );
    // Dev path must not double-fire to Sentry.
    expect(sentryMock.captureMessage).not.toHaveBeenCalled();
  });

  it("throws on the test environment too (NODE_ENV !== production)", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() =>
      handlePiiViolation("analytics-server", "auth.signed_in", {
        beneficiary_name: "Maria",
      }),
    ).toThrowError(/beneficiary_name/);
  });

  it("lists every offending key, not just the first", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() =>
      handlePiiViolation("analytics-client", "fake.event", {
        email: "x",
        beneficiary_name: "y",
        case_id: "ok",
      }),
    ).toThrowError(/email.*beneficiary_name|beneficiary_name.*email/);
  });
});

describe("handlePiiViolation — prod branch", () => {
  it("does NOT throw in production; routes to Sentry instead", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      handlePiiViolation("analytics-client", "case.created", {
        case_id: "abc",
        email: "leaked@example.com",
      }),
    ).not.toThrow();
    expect(sentryMock.captureMessage).toHaveBeenCalledTimes(1);
    const [message, opts] = sentryMock.captureMessage.mock.calls[0]!;
    expect(message).toContain("[analytics-client]");
    expect(message).toContain("case.created");
    expect(message).toContain("email");
    // CRITICAL: the message must NOT include the PII *value*. The
    // event name and offending key are safe to log; the value is the
    // PII we're trying to protect.
    expect(message).not.toContain("leaked@example.com");
    expect(opts).toMatchObject({
      level: "error",
      tags: expect.objectContaining({
        event: "case.created",
      }),
    });
  });

  it("source tag distinguishes client vs server", () => {
    vi.stubEnv("NODE_ENV", "production");
    handlePiiViolation("analytics-server", "case.created", { email: "x" });
    expect(sentryMock.captureMessage.mock.calls[0]![1]).toMatchObject({
      tags: expect.objectContaining({ source: "analytics-server-pii-guard" }),
    });
  });
});
