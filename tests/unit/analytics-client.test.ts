// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/analytics/client.ts` — typed PostHog browser wrapper.
 *
 * Mocks `posthog-js` so the wrapper's contract can be exercised
 * without ever touching the real SDK or network. Two states for the
 * SDK: pre-init (`__loaded=false`, every wrapper call is a no-op) and
 * post-init (`__loaded=true`, wrapper forwards to `posthog.capture` /
 * `posthog.identify` / `posthog.reset`).
 */

const posthogMock = vi.hoisted(() => ({
  __loaded: false,
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: posthogMock }));

import {
  capturePageview,
  identify,
  reset,
  track,
} from "@/lib/analytics/client";

beforeEach(() => {
  posthogMock.capture.mockReset();
  posthogMock.identify.mockReset();
  posthogMock.reset.mockReset();
  posthogMock.__loaded = true;
});

afterEach(() => {
  posthogMock.__loaded = false;
});

describe("track — pre-init", () => {
  it("is a no-op when posthog.__loaded is false (no exception, no capture)", () => {
    posthogMock.__loaded = false;
    expect(() =>
      track({
        name: "case.created",
        properties: { case_id: "case-1", visa_type: "O-1A" },
      }),
    ).not.toThrow();
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });
});

describe("track — post-init", () => {
  it("forwards event name + properties to posthog.capture", () => {
    track({
      name: "case.created",
      properties: { case_id: "case-1", visa_type: "O-1A" },
    });
    expect(posthogMock.capture).toHaveBeenCalledTimes(1);
    expect(posthogMock.capture).toHaveBeenCalledWith("case.created", {
      case_id: "case-1",
      visa_type: "O-1A",
    });
  });

  it("does NOT mutate the caller's properties bag", () => {
    const properties = { case_id: "case-1", visa_type: "O-1A" } as const;
    track({ name: "case.created", properties });
    // Same identity passed through.
    expect(posthogMock.capture.mock.calls[0]![1]).toBe(properties);
  });
});

describe("identify", () => {
  it("forwards a non-empty userId to posthog.identify", () => {
    identify("user-uuid-1");
    expect(posthogMock.identify).toHaveBeenCalledTimes(1);
    expect(posthogMock.identify).toHaveBeenCalledWith("user-uuid-1");
  });

  it("is a no-op for empty string (would create a phantom profile)", () => {
    identify("");
    expect(posthogMock.identify).not.toHaveBeenCalled();
  });

  it("is a no-op when posthog.__loaded is false", () => {
    posthogMock.__loaded = false;
    identify("user-uuid-1");
    expect(posthogMock.identify).not.toHaveBeenCalled();
  });
});

describe("reset", () => {
  it("calls posthog.reset when initialised", () => {
    reset();
    expect(posthogMock.reset).toHaveBeenCalledTimes(1);
  });

  it("is a no-op pre-init", () => {
    posthogMock.__loaded = false;
    reset();
    expect(posthogMock.reset).not.toHaveBeenCalled();
  });
});

describe("capturePageview", () => {
  it("emits $pageview with $current_url", () => {
    capturePageview("/case/abc?tab=outputs");
    expect(posthogMock.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: "/case/abc?tab=outputs",
    });
  });

  it("is a no-op pre-init", () => {
    posthogMock.__loaded = false;
    capturePageview("/foo");
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });
});
