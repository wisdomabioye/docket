import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/health` (Phase 12 upgrade). Locks the new behaviors:
 *   - `perplexity` reads `computer:health:status` from Redis (NEVER
 *     calls Sonar — that would be billable on every probe).
 *   - `redis` does an actual `ping` round-trip (not just env presence).
 *   - `unknown` is distinguished from `not_configured` and `error`.
 *   - Overall status is `degraded` only on hard `error` of integrations
 *     we actively use.
 */

const envState = vi.hoisted(() => ({
  NODE_ENV: "test",
  DATABASE_URL: undefined as string | undefined,
  PERPLEXITY_API_KEY: undefined as string | undefined,
  UPSTASH_REDIS_REST_URL: undefined as string | undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined as string | undefined,
  AUTH_SECRET: undefined as string | undefined,
  AUTH_GOOGLE_ID: undefined as string | undefined,
  AUTH_MICROSOFT_ID: undefined as string | undefined,
  STRIPE_SECRET_KEY: undefined as string | undefined,
  POSTMARK_API_KEY: undefined as string | undefined,
  INNGEST_EVENT_KEY: undefined as string | undefined,
}));

vi.mock("@/config/env", () => ({ env: envState }));

const redisMock = vi.hoisted(() => ({
  ping: vi.fn(),
  get: vi.fn(),
}));
const getRedisMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/redis", () => ({
  getRedis: getRedisMock,
}));

const dbExecuteMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/db/client", () => ({
  db: { execute: dbExecuteMock },
}));

afterEach(() => {
  redisMock.ping.mockReset();
  redisMock.get.mockReset();
  getRedisMock.mockReset();
  dbExecuteMock.mockReset();
  // Reset env between tests.
  envState.DATABASE_URL = undefined;
  envState.PERPLEXITY_API_KEY = undefined;
  envState.UPSTASH_REDIS_REST_URL = undefined;
  envState.UPSTASH_REDIS_REST_TOKEN = undefined;
});

async function getHealth(): Promise<{
  status: "ok" | "degraded";
  integrations: Record<string, string>;
}> {
  const { GET } = await import("@/app/api/health/route");
  const res = await GET();
  return await res.json();
}

describe("/api/health — perplexity (cached)", () => {
  it("not_configured when PERPLEXITY_API_KEY is unset", async () => {
    envState.PERPLEXITY_API_KEY = undefined;
    const r = await getHealth();
    expect(r.integrations.perplexity).toBe("not_configured");
  });

  it("unknown when key is set but Redis isn't (no cache available)", async () => {
    envState.PERPLEXITY_API_KEY = "pplx-xxx";
    // Redis env unset → getCachedComputerStatus returns "unknown"
    // before even hitting redis client; getRedis stays unstubbed.
    const r = await getHealth();
    expect(r.integrations.perplexity).toBe("unknown");
    // CRITICAL: no Sonar call should ever be made by the route. We
    // don't have a Sonar mock — its presence in the call graph would
    // be a test failure. (Implicit assertion via no-mock setup.)
  });

  it("unknown when cron hasn't run (Redis returns null)", async () => {
    envState.PERPLEXITY_API_KEY = "pplx-xxx";
    envState.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
    envState.UPSTASH_REDIS_REST_TOKEN = "tok";
    getRedisMock.mockReturnValue(redisMock);
    redisMock.get.mockResolvedValueOnce(null);
    redisMock.ping.mockResolvedValueOnce("PONG");
    const r = await getHealth();
    expect(r.integrations.perplexity).toBe("unknown");
  });

  it("connected when cached status is up", async () => {
    envState.PERPLEXITY_API_KEY = "pplx-xxx";
    envState.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
    envState.UPSTASH_REDIS_REST_TOKEN = "tok";
    getRedisMock.mockReturnValue(redisMock);
    redisMock.get.mockResolvedValueOnce({ status: "up" });
    redisMock.ping.mockResolvedValueOnce("PONG");
    const r = await getHealth();
    expect(r.integrations.perplexity).toBe("connected");
    expect(r.status).toBe("ok");
  });

  it("error when cached status is down → degrades overall", async () => {
    envState.PERPLEXITY_API_KEY = "pplx-xxx";
    envState.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
    envState.UPSTASH_REDIS_REST_TOKEN = "tok";
    getRedisMock.mockReturnValue(redisMock);
    redisMock.get.mockResolvedValueOnce({ status: "down" });
    redisMock.ping.mockResolvedValueOnce("PONG");
    const r = await getHealth();
    expect(r.integrations.perplexity).toBe("error");
    expect(r.status).toBe("degraded");
  });
});

describe("/api/health — redis (live ping)", () => {
  it("not_configured when env unset", async () => {
    const r = await getHealth();
    expect(r.integrations.redis).toBe("not_configured");
  });

  it("connected when ping returns PONG", async () => {
    envState.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
    envState.UPSTASH_REDIS_REST_TOKEN = "tok";
    getRedisMock.mockReturnValue(redisMock);
    redisMock.ping.mockResolvedValueOnce("PONG");
    const r = await getHealth();
    expect(r.integrations.redis).toBe("connected");
  });

  it("error when ping throws → degrades overall", async () => {
    envState.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
    envState.UPSTASH_REDIS_REST_TOKEN = "tok";
    getRedisMock.mockReturnValue(redisMock);
    redisMock.ping.mockRejectedValueOnce(new Error("network"));
    const r = await getHealth();
    expect(r.integrations.redis).toBe("error");
    expect(r.status).toBe("degraded");
  });
});

describe("/api/health — overall status logic", () => {
  it("ok when no integrations are in error", async () => {
    const r = await getHealth();
    expect(r.status).toBe("ok");
  });

  it("not_configured does NOT degrade", async () => {
    // All env unset → all integrations not_configured/unknown → still ok
    const r = await getHealth();
    expect(r.status).toBe("ok");
  });

  it("database error degrades", async () => {
    envState.DATABASE_URL = "postgres://x";
    dbExecuteMock.mockRejectedValueOnce(new Error("conn refused"));
    const r = await getHealth();
    expect(r.integrations.database).toBe("error");
    expect(r.status).toBe("degraded");
  });
});
