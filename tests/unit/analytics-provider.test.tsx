// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * `components/analytics/PostHogProvider.tsx` and
 * `components/analytics/PostHogIdentify.tsx` — wrappers that mount
 * around the app to bootstrap PostHog and bind the user identity.
 *
 * Mocks:
 *   - `posthog-js` — `init`, `capture`, `identify`, `__loaded` flag.
 *   - `next/navigation` — `usePathname` + `useSearchParams` are
 *     hoisted state we control per-test so we can simulate route
 *     changes inside a single render.
 *   - `@/config/public-env` — toggle `posthogKey` to exercise the
 *     init-gated branch.
 */

const posthogMock = vi.hoisted(() => ({
  __loaded: false,
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: posthogMock }));

const navState = vi.hoisted(() => ({
  pathname: "/",
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
  useSearchParams: () => navState.searchParams,
}));

const publicEnvState = vi.hoisted(() => ({
  posthogKey: undefined as string | undefined,
  posthogHost: undefined as string | undefined,
}));

vi.mock("@/config/public-env", () => ({ publicEnv: publicEnvState }));

beforeEach(() => {
  posthogMock.__loaded = false;
  posthogMock.init.mockReset();
  posthogMock.init.mockImplementation(() => {
    posthogMock.__loaded = true;
  });
  posthogMock.capture.mockReset();
  posthogMock.identify.mockReset();
  posthogMock.reset.mockReset();
  publicEnvState.posthogKey = undefined;
  publicEnvState.posthogHost = undefined;
  navState.pathname = "/";
  navState.searchParams = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  // Reset module state — `initAttempted` is module-scoped; importing
  // a fresh copy per test avoids cross-test bleed.
  vi.resetModules();
});

async function importProvider(): Promise<typeof import("@/components/analytics/PostHogProvider")> {
  return await import("@/components/analytics/PostHogProvider");
}

async function importIdentify(): Promise<typeof import("@/components/analytics/PostHogIdentify")> {
  return await import("@/components/analytics/PostHogIdentify");
}

describe("PostHogProvider — init", () => {
  it("does NOT call posthog.init when posthogKey is unset", async () => {
    const { PostHogProvider } = await importProvider();
    render(<PostHogProvider><div>child</div></PostHogProvider>);
    expect(posthogMock.init).not.toHaveBeenCalled();
  });

  it("calls posthog.init synchronously with the configured key + options", async () => {
    publicEnvState.posthogKey = "phc_xxx";
    publicEnvState.posthogHost = "https://eu.i.posthog.com";
    const { PostHogProvider } = await importProvider();
    render(<PostHogProvider><div>child</div></PostHogProvider>);
    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    const [key, opts] = posthogMock.init.mock.calls[0]!;
    expect(key).toBe("phc_xxx");
    expect(opts).toMatchObject({
      api_host: "https://eu.i.posthog.com",
      capture_pageview: false,
      capture_pageleave: "if_capture_pageview",
      person_profiles: "identified_only",
      disable_session_recording: true,
    });
    expect(typeof (opts as { before_send: unknown }).before_send).toBe(
      "function",
    );
  });

  it("init only fires once across multiple provider renders", async () => {
    publicEnvState.posthogKey = "phc_xxx";
    const { PostHogProvider } = await importProvider();
    const { rerender } = render(
      <PostHogProvider><div>a</div></PostHogProvider>,
    );
    rerender(<PostHogProvider><div>b</div></PostHogProvider>);
    rerender(<PostHogProvider><div>c</div></PostHogProvider>);
    expect(posthogMock.init).toHaveBeenCalledTimes(1);
  });
});

describe("PostHogProvider — pageview capture", () => {
  it("emits $pageview after the pathname effect fires (initialised)", async () => {
    publicEnvState.posthogKey = "phc_xxx";
    navState.pathname = "/case/abc";
    navState.searchParams = new URLSearchParams("tab=outputs");
    const { PostHogProvider } = await importProvider();
    render(<PostHogProvider><div>child</div></PostHogProvider>);
    // Effect fires after commit — flush microtasks.
    await act(async () => {
      await Promise.resolve();
    });
    expect(posthogMock.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: "/case/abc?tab=outputs",
    });
  });

  it("uses pathname-only when no search params", async () => {
    publicEnvState.posthogKey = "phc_xxx";
    navState.pathname = "/dashboard";
    const { PostHogProvider } = await importProvider();
    render(<PostHogProvider><div>child</div></PostHogProvider>);
    await act(async () => {
      await Promise.resolve();
    });
    expect(posthogMock.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: "/dashboard",
    });
  });

  it("does NOT capture when posthog.__loaded is false (init failed / no key)", async () => {
    publicEnvState.posthogKey = undefined; // init won't run → __loaded stays false
    navState.pathname = "/dashboard";
    const { PostHogProvider } = await importProvider();
    render(<PostHogProvider><div>child</div></PostHogProvider>);
    await act(async () => {
      await Promise.resolve();
    });
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });
});

describe("PostHogIdentify", () => {
  it("calls identify(userId) once on mount when posthog is initialised", async () => {
    posthogMock.__loaded = true;
    const { PostHogIdentify } = await importIdentify();
    render(<PostHogIdentify userId="user-uuid-1" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(posthogMock.identify).toHaveBeenCalledTimes(1);
    expect(posthogMock.identify).toHaveBeenCalledWith("user-uuid-1");
  });

  it("does not re-identify on a re-render with the same userId", async () => {
    posthogMock.__loaded = true;
    const { PostHogIdentify } = await importIdentify();
    const { rerender } = render(<PostHogIdentify userId="user-uuid-1" />);
    await act(async () => {
      await Promise.resolve();
    });
    rerender(<PostHogIdentify userId="user-uuid-1" />);
    rerender(<PostHogIdentify userId="user-uuid-1" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(posthogMock.identify).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for empty userId", async () => {
    posthogMock.__loaded = true;
    const { PostHogIdentify } = await importIdentify();
    render(<PostHogIdentify userId="" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(posthogMock.identify).not.toHaveBeenCalled();
  });
});
