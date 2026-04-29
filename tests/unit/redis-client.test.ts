import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `getRedis()` is a lazy singleton. We mock `@/config/env` so the test
 * controls whether `UPSTASH_REDIS_REST_URL` + `_TOKEN` are set, and
 * exercise both branches: configured (returns a cached instance) and
 * unconfigured (returns null without throwing).
 */

const envState = vi.hoisted(() => ({
  UPSTASH_REDIS_REST_URL: undefined as string | undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined as string | undefined,
}));

vi.mock("@/config/env", () => ({ env: envState }));

afterEach(async () => {
  const mod = await import("@/server/services/redis");
  mod.__resetRedisForTest();
  envState.UPSTASH_REDIS_REST_URL = undefined;
  envState.UPSTASH_REDIS_REST_TOKEN = undefined;
});

describe("getRedis", () => {
  it("returns null when URL/token are unset", async () => {
    const { getRedis } = await import("@/server/services/redis");
    expect(getRedis()).toBeNull();
  });

  it("returns null when only URL is set", async () => {
    envState.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    const { getRedis } = await import("@/server/services/redis");
    expect(getRedis()).toBeNull();
  });

  it("returns a Redis instance when both env vars are set", async () => {
    envState.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    envState.UPSTASH_REDIS_REST_TOKEN = "tok";
    const { getRedis } = await import("@/server/services/redis");
    const { Redis } = await import("@upstash/redis");
    const client = getRedis();
    expect(client).toBeInstanceOf(Redis);
  });

  it("caches the instance across calls (singleton)", async () => {
    envState.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    envState.UPSTASH_REDIS_REST_TOKEN = "tok";
    const { getRedis } = await import("@/server/services/redis");
    expect(getRedis()).toBe(getRedis());
  });

  it("caches the null result too — env change between calls is ignored without reset", async () => {
    const mod = await import("@/server/services/redis");
    expect(mod.getRedis()).toBeNull();
    envState.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    envState.UPSTASH_REDIS_REST_TOKEN = "tok";
    // Without __resetRedisForTest the cached null sticks — protects against
    // mid-process env mutation racing with first construction.
    expect(mod.getRedis()).toBeNull();
  });
});
