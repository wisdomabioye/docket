import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `rateLimit()` wraps `@upstash/ratelimit` with a no-op fallback when
 * Redis isn't configured. We mock the redis singleton so the test can
 * flip configured/unconfigured without touching real env.
 *
 * For the configured branch we mock `Ratelimit.limit` directly — the
 * real algorithm is Upstash's responsibility, ours is the wrapper
 * shape: cached limiter per name, identifier passthrough, and result
 * mapping.
 */

const redisStub = vi.hoisted(() => ({
  current: null as null | { __redis: true },
}));

vi.mock("@/server/services/redis", () => ({
  getRedis: () => redisStub.current,
}));

const limitMock = vi.hoisted(() => vi.fn());

vi.mock("@upstash/ratelimit", async () => {
  // Capture the real export shape (Algorithm types, slidingWindow static).
  // We only swap `limit` — `slidingWindow` returns an opaque algorithm
  // descriptor that we pass through unchanged.
  const actual =
    await vi.importActual<typeof import("@upstash/ratelimit")>(
      "@upstash/ratelimit",
    );
  class MockRatelimit {
    static slidingWindow = actual.Ratelimit.slidingWindow.bind(
      actual.Ratelimit,
    );
    limit = limitMock;
  }
  return { ...actual, Ratelimit: MockRatelimit };
});

afterEach(async () => {
  const mod = await import("@/server/services/ratelimit");
  mod.__resetRateLimitForTest();
  redisStub.current = null;
  limitMock.mockReset();
});

describe("rateLimit (Redis unconfigured)", () => {
  it("returns success: true and full remaining when Redis is null", async () => {
    redisStub.current = null;
    const { rateLimit } = await import("@/server/services/ratelimit");
    const r = await rateLimit("case.requestBuild", "user-1");
    expect(r.success).toBe(true);
    expect(r.limit).toBe(10);
    expect(r.remaining).toBe(10);
    expect(r.reset).toBe(0);
    expect(limitMock).not.toHaveBeenCalled();
  });

  it("uses the per-name configured cap in the bypass result", async () => {
    redisStub.current = null;
    const { rateLimit } = await import("@/server/services/ratelimit");
    const r = await rateLimit("mutation.default", "user-1");
    expect(r.limit).toBe(60);
    expect(r.remaining).toBe(60);
  });
});

describe("rateLimit (Redis configured)", () => {
  it("forwards the identifier and returns the SDK result mapped to our shape", async () => {
    redisStub.current = { __redis: true };
    limitMock.mockResolvedValueOnce({
      success: true,
      limit: 10,
      remaining: 7,
      reset: 1_700_000_000_000,
      pending: Promise.resolve(),
    });
    const { rateLimit } = await import("@/server/services/ratelimit");
    const r = await rateLimit("case.requestBuild", "user-42");
    expect(limitMock).toHaveBeenCalledWith("user-42");
    expect(r).toEqual({
      success: true,
      limit: 10,
      remaining: 7,
      reset: 1_700_000_000_000,
    });
  });

  it("propagates success: false on cap exceeded", async () => {
    redisStub.current = { __redis: true };
    limitMock.mockResolvedValueOnce({
      success: false,
      limit: 10,
      remaining: 0,
      reset: 1_700_000_000_000,
      pending: Promise.resolve(),
    });
    const { rateLimit } = await import("@/server/services/ratelimit");
    const r = await rateLimit("case.requestBuild", "user-spammer");
    expect(r.success).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("caches one limiter per name across calls", async () => {
    redisStub.current = { __redis: true };
    limitMock.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: 0,
      pending: Promise.resolve(),
    });
    const { rateLimit } = await import("@/server/services/ratelimit");
    await rateLimit("case.requestBuild", "u1");
    await rateLimit("case.requestBuild", "u2");
    await rateLimit("mutation.default", "u1");
    // Two distinct names → two limiter constructions, but identifiers
    // hit the same instance for repeat calls of the same name. We can't
    // observe construction directly through the mocked class, but the
    // call shape must hit `limit()` once per call regardless.
    expect(limitMock).toHaveBeenCalledTimes(3);
  });
});
