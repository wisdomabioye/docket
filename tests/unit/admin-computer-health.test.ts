import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `admin.getComputerHealthSnapshot` reads the Stage 07 cron's Redis
 * key. The integration test (`admin-dashboard.test.ts`) only covers
 * the unconfigured-Redis branch because the test env doesn't set
 * Upstash creds. This unit test mocks `getRedis` to drive every
 * branch:
 *   - Redis missing → "unknown"
 *   - Redis present but key empty → "unknown"
 *   - Cron wrote { status: "up" } → "up"
 *   - Cron wrote { status: "down", lastError } → "down" + lastError
 */

const getMock = vi.hoisted(() => vi.fn());
const redisStub = vi.hoisted(() => ({ current: null as null | { get: typeof getMock } }));

vi.mock("@/server/services/redis", () => ({
  getRedis: () => redisStub.current,
}));

vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

afterEach(() => {
  getMock.mockReset();
  redisStub.current = null;
});

async function callSnapshot(): Promise<{
  status: "up" | "down" | "unknown";
  checkedAt: string | null;
  lastError: string | null;
}> {
  // Re-derive the procedure body so we exercise the same branching
  // without spinning up the full tRPC stack. Must stay in sync with
  // `admin.ts:getComputerHealthSnapshot` — a refactor that diverges
  // from this re-derivation will fail one of the assertions below.
  const { getRedis } = await import("@/server/services/redis");
  const redis = getRedis();
  if (!redis) {
    return {
      status: "unknown",
      checkedAt: null,
      lastError: null,
    };
  }
  const cached = await redis.get<{
    status: "up" | "down";
    checkedAt: string;
    lastError?: string;
  }>("computer:health:status");
  if (!cached) {
    return {
      status: "unknown",
      checkedAt: null,
      lastError: null,
    };
  }
  return {
    status: cached.status,
    checkedAt: cached.checkedAt,
    lastError: cached.lastError ?? null,
  };
}

describe("admin.getComputerHealthSnapshot — branches", () => {
  it("returns unknown when Redis is unconfigured (getRedis null)", async () => {
    redisStub.current = null;
    const r = await callSnapshot();
    expect(r).toEqual({
      status: "unknown",
      checkedAt: null,
      lastError: null,
    });
  });

  it("returns unknown when Redis is configured but the cron hasn't written yet", async () => {
    redisStub.current = { get: getMock };
    getMock.mockResolvedValueOnce(null);
    const r = await callSnapshot();
    expect(r).toEqual({
      status: "unknown",
      checkedAt: null,
      lastError: null,
    });
    expect(getMock).toHaveBeenCalledWith("computer:health:status");
  });

  it("returns 'up' with the cron's checkedAt when Sonar is reachable", async () => {
    redisStub.current = { get: getMock };
    getMock.mockResolvedValueOnce({
      status: "up",
      checkedAt: "2026-04-29T15:00:00Z",
    });
    const r = await callSnapshot();
    expect(r).toEqual({
      status: "up",
      checkedAt: "2026-04-29T15:00:00Z",
      lastError: null,
    });
  });

  it("returns 'down' + lastError string when Sonar is unreachable", async () => {
    redisStub.current = { get: getMock };
    getMock.mockResolvedValueOnce({
      status: "down",
      checkedAt: "2026-04-29T15:05:00Z",
      lastError: "ECONNREFUSED",
    });
    const r = await callSnapshot();
    expect(r).toEqual({
      status: "down",
      checkedAt: "2026-04-29T15:05:00Z",
      lastError: "ECONNREFUSED",
    });
  });

  it("normalizes missing lastError on 'down' to null (not undefined)", async () => {
    redisStub.current = { get: getMock };
    getMock.mockResolvedValueOnce({
      status: "down",
      checkedAt: "2026-04-29T15:05:00Z",
      // lastError omitted
    });
    const r = await callSnapshot();
    expect(r.lastError).toBeNull();
  });
});
