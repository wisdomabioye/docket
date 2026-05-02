// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `server/services/analytics/server.ts` — typed posthog-node wrapper —
 * plus `server/services/analytics/emit.ts` — the tRPC / job convenience
 * helpers built on top.
 *
 * Mocks:
 *   - `posthog-node`'s `PostHog` class — a constructor spy + per-method
 *     spies. Lets us assert `getClient()`'s lazy/cached behavior and
 *     that `captureImmediate` / `identifyImmediate` get the right args.
 *   - `@/config/env` — `NEXT_PUBLIC_POSTHOG_KEY` is undefined by
 *     default; tests set it before invoking the wrapper to enter the
 *     "configured" branch.
 *   - `@sentry/nextjs` — error-path forwarding is asserted via the
 *     `captureException` spy.
 */

const PostHogCtor = vi.hoisted(() => vi.fn());
const captureImmediateMock = vi.hoisted(() => vi.fn());
const identifyImmediateMock = vi.hoisted(() => vi.fn());

vi.mock("posthog-node", () => {
  // `posthog-node` is consumed as `new PostHog(...)`, so the mock has
  // to be a real constructable. A class (rather than `vi.fn()`) is
  // the simplest way to give the mock `new` semantics while still
  // recording calls — the constructor body forwards args to the spy.
  class PostHog {
    captureImmediate = captureImmediateMock;
    identifyImmediate = identifyImmediateMock;
    constructor(...args: unknown[]) {
      PostHogCtor(...args);
    }
  }
  return { PostHog };
});

const envState = vi.hoisted(() => ({
  NEXT_PUBLIC_POSTHOG_KEY: undefined as string | undefined,
  NEXT_PUBLIC_POSTHOG_HOST: undefined as string | undefined,
}));

vi.mock("@/config/env", () => ({ env: envState }));

const sentryMock = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentryMock);

import {
  __resetAnalyticsClientForTests,
  identifyServer,
  trackServer,
} from "@/server/services/analytics/server";
import {
  emitFromCtx,
  emitFromUser,
} from "@/server/services/analytics/emit";

beforeEach(() => {
  PostHogCtor.mockClear();
  captureImmediateMock.mockReset();
  captureImmediateMock.mockResolvedValue(undefined);
  identifyImmediateMock.mockReset();
  identifyImmediateMock.mockResolvedValue(undefined);
  sentryMock.captureException.mockReset();
  sentryMock.captureMessage.mockReset();
  envState.NEXT_PUBLIC_POSTHOG_KEY = undefined;
  envState.NEXT_PUBLIC_POSTHOG_HOST = undefined;
  __resetAnalyticsClientForTests();
});

afterEach(() => {
  __resetAnalyticsClientForTests();
});

describe("trackServer — configuration gate", () => {
  it("no-ops (and never constructs a client) when POSTHOG_KEY is unset", async () => {
    await trackServer("user-1", {
      name: "case.created",
      properties: { case_id: "c1", visa_type: "O-1A" },
    });
    expect(PostHogCtor).not.toHaveBeenCalled();
    expect(captureImmediateMock).not.toHaveBeenCalled();
  });

  it("no-ops on empty distinctId (would create a phantom profile)", async () => {
    envState.NEXT_PUBLIC_POSTHOG_KEY = "phc_xxx";
    await trackServer("", {
      name: "case.created",
      properties: { case_id: "c1", visa_type: "O-1A" },
    });
    expect(captureImmediateMock).not.toHaveBeenCalled();
  });
});

describe("trackServer — happy path", () => {
  beforeEach(() => {
    envState.NEXT_PUBLIC_POSTHOG_KEY = "phc_xxx";
    envState.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com";
  });

  it("constructs PostHog with the public key + host + serverless-safe options", async () => {
    await trackServer("user-1", {
      name: "case.created",
      properties: { case_id: "c1", visa_type: "O-1A" },
    });
    expect(PostHogCtor).toHaveBeenCalledTimes(1);
    const [key, opts] = PostHogCtor.mock.calls[0]!;
    expect(key).toBe("phc_xxx");
    expect(opts).toMatchObject({
      host: "https://eu.i.posthog.com",
      enableLocalEvaluation: false,
      flushAt: 1,
      flushInterval: 0,
    });
    // `before_send` is wired so PII can be scrubbed at the wire.
    expect(typeof (opts as { before_send?: unknown }).before_send).toBe(
      "function",
    );
  });

  it("defaults host to us.i.posthog.com when NEXT_PUBLIC_POSTHOG_HOST unset", async () => {
    envState.NEXT_PUBLIC_POSTHOG_HOST = undefined;
    await trackServer("user-1", {
      name: "case.created",
      properties: { case_id: "c1", visa_type: "O-1A" },
    });
    const [, opts] = PostHogCtor.mock.calls[0]!;
    expect((opts as { host: string }).host).toBe("https://us.i.posthog.com");
  });

  it("forwards distinctId + event name + properties to captureImmediate", async () => {
    await trackServer("user-1", {
      name: "case.created",
      properties: { case_id: "c1", visa_type: "O-1A" },
    });
    expect(captureImmediateMock).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "case.created",
      properties: { case_id: "c1", visa_type: "O-1A" },
    });
  });

  it("caches the client across multiple emits (single PostHog construction)", async () => {
    await trackServer("user-1", {
      name: "case.created",
      properties: { case_id: "c1", visa_type: "O-1A" },
    });
    await trackServer("user-2", {
      name: "case.archived",
      properties: { case_id: "c2", prior_status: "draft_ready" },
    });
    expect(PostHogCtor).toHaveBeenCalledTimes(1);
    expect(captureImmediateMock).toHaveBeenCalledTimes(2);
  });
});

describe("trackServer — error path", () => {
  beforeEach(() => {
    envState.NEXT_PUBLIC_POSTHOG_KEY = "phc_xxx";
  });

  it("swallows captureImmediate failures and forwards them to Sentry", async () => {
    const boom = new Error("network down");
    captureImmediateMock.mockRejectedValueOnce(boom);
    await expect(
      trackServer("user-1", {
        name: "case.created",
        properties: { case_id: "c1", visa_type: "O-1A" },
      }),
    ).resolves.toBeUndefined();
    expect(sentryMock.captureException).toHaveBeenCalledWith(boom, {
      tags: { source: "analytics-server", event: "case.created" },
    });
  });
});

describe("identifyServer", () => {
  beforeEach(() => {
    envState.NEXT_PUBLIC_POSTHOG_KEY = "phc_xxx";
  });

  it("forwards distinctId + properties to identifyImmediate", async () => {
    await identifyServer("user-1", { provider: "google", role: "attorney" });
    expect(identifyImmediateMock).toHaveBeenCalledWith({
      distinctId: "user-1",
      properties: { provider: "google", role: "attorney" },
    });
  });

  it("no-ops on empty distinctId", async () => {
    await identifyServer("", { provider: "google" });
    expect(identifyImmediateMock).not.toHaveBeenCalled();
  });

  it("forwards identify errors to Sentry without throwing", async () => {
    const boom = new Error("bad request");
    identifyImmediateMock.mockRejectedValueOnce(boom);
    await expect(
      identifyServer("user-1", { provider: "google" }),
    ).resolves.toBeUndefined();
    expect(sentryMock.captureException).toHaveBeenCalledWith(boom, {
      tags: { source: "analytics-server", event: "identify" },
    });
  });
});

describe("emitFromCtx", () => {
  beforeEach(() => {
    envState.NEXT_PUBLIC_POSTHOG_KEY = "phc_xxx";
  });

  it("uses ctx.user.id as distinctId when authenticated", async () => {
    emitFromCtx(
      {
        headers: new Headers(),
        user: { id: "user-1" },
      },
      {
        name: "case.created",
        properties: { case_id: "c1", visa_type: "O-1A" },
      },
    );
    // Wait a microtask so the fire-and-forget `void` promise resolves.
    await new Promise((r) => setImmediate(r));
    expect(captureImmediateMock).toHaveBeenCalledWith(
      expect.objectContaining({ distinctId: "user-1" }),
    );
  });

  it("falls back to `system:trpc` when ctx.user is null", async () => {
    emitFromCtx(
      { headers: new Headers(), user: null },
      {
        name: "case.created",
        properties: { case_id: "c1", visa_type: "O-1A" },
      },
    );
    await new Promise((r) => setImmediate(r));
    expect(captureImmediateMock).toHaveBeenCalledWith(
      expect.objectContaining({ distinctId: "system:trpc" }),
    );
  });
});

describe("emitFromUser", () => {
  beforeEach(() => {
    envState.NEXT_PUBLIC_POSTHOG_KEY = "phc_xxx";
  });

  it("returns the underlying promise (not fire-and-forget)", async () => {
    const result = emitFromUser("user-1", {
      name: "auth.signed_in",
      properties: { provider: "google", is_new_user: true },
    });
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(captureImmediateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user-1",
        event: "auth.signed_in",
      }),
    );
  });

  it("falls back to `system:job` for null userId (Inngest jobs without an actor)", async () => {
    await emitFromUser(null, {
      name: "case.created",
      properties: { case_id: "c1", visa_type: "O-1A" },
    });
    expect(captureImmediateMock).toHaveBeenCalledWith(
      expect.objectContaining({ distinctId: "system:job" }),
    );
  });

  it("falls back to `system:job` for undefined userId", async () => {
    await emitFromUser(undefined, {
      name: "case.created",
      properties: { case_id: "c1", visa_type: "O-1A" },
    });
    expect(captureImmediateMock).toHaveBeenCalledWith(
      expect.objectContaining({ distinctId: "system:job" }),
    );
  });
});
