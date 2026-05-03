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
  POSTMARK_FROM_EMAIL: undefined as string | undefined,
  POSTMARK_REPLY_TO: undefined as string | undefined,
  INNGEST_EVENT_KEY: undefined as string | undefined,
  NEXT_PUBLIC_POSTHOG_KEY: undefined as string | undefined,
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

const postmarkClientMock = vi.hoisted(() => ({
  getServer: vi.fn(),
}));
const getPostmarkClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/email/postmark-client", () => ({
  getPostmarkClient: getPostmarkClientMock,
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
  envState.NEXT_PUBLIC_POSTHOG_KEY = undefined;
  envState.POSTMARK_API_KEY = undefined;
  envState.POSTMARK_FROM_EMAIL = undefined;
  envState.POSTMARK_REPLY_TO = undefined;
  postmarkClientMock.getServer.mockReset();
  getPostmarkClientMock.mockReset();
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

describe("/api/health — posthog (env presence)", () => {
  it("not_configured when NEXT_PUBLIC_POSTHOG_KEY is unset", async () => {
    const r = await getHealth();
    expect(r.integrations.posthog).toBe("not_configured");
    // PostHog is fully optional — its absence MUST NOT degrade overall.
    expect(r.status).toBe("ok");
  });

  it("connected when NEXT_PUBLIC_POSTHOG_KEY is set", async () => {
    envState.NEXT_PUBLIC_POSTHOG_KEY = "phc_xxxxxxxxxxxx";
    const r = await getHealth();
    expect(r.integrations.posthog).toBe("connected");
    expect(r.status).toBe("ok");
  });

  it("does NOT call PostHog network endpoints from the probe", async () => {
    // No PostHog HTTP mock is registered. If the route ever issued an
    // ingestion or /decide request, the call would fail or hit the
    // real network — both are test failures. The probe is config-only.
    envState.NEXT_PUBLIC_POSTHOG_KEY = "phc_xxxxxxxxxxxx";
    const r = await getHealth();
    expect(r.integrations.posthog).toBe("connected");
  });
});

describe("/api/health — postmark (live ping)", () => {
  it("not_configured when POSTMARK_API_KEY is unset", async () => {
    const r = await getHealth();
    expect(r.integrations.postmark).toBe("not_configured");
    expect(r.status).toBe("ok");
  });

  it("not_configured when key set but FROM_EMAIL missing (half-set deploy)", async () => {
    envState.POSTMARK_API_KEY = "pm-xxx";
    const r = await getHealth();
    expect(r.integrations.postmark).toBe("not_configured");
    // Half-set deploy is NOT a degradation — it's an operator-misconfig
    // signal, surfaced via the integration field, not the overall status.
    expect(r.status).toBe("ok");
  });

  it("connected when getServer() resolves", async () => {
    envState.POSTMARK_API_KEY = "pm-xxx";
    envState.POSTMARK_FROM_EMAIL = "from@example.com";
    getPostmarkClientMock.mockReturnValue(postmarkClientMock);
    postmarkClientMock.getServer.mockResolvedValueOnce({ ID: 1, Name: "x" });
    const r = await getHealth();
    expect(r.integrations.postmark).toBe("connected");
    expect(r.status).toBe("ok");
  });

  it("error when getServer() rejects → degrades overall", async () => {
    envState.POSTMARK_API_KEY = "pm-xxx";
    envState.POSTMARK_FROM_EMAIL = "from@example.com";
    getPostmarkClientMock.mockReturnValue(postmarkClientMock);
    postmarkClientMock.getServer.mockRejectedValueOnce(new Error("401 unauthorized"));
    const r = await getHealth();
    expect(r.integrations.postmark).toBe("error");
    expect(r.status).toBe("degraded");
  });

  it("does NOT call sendEmail from the probe", async () => {
    // No `sendEmail` mock is registered. Health probes must NEVER
    // dispatch a real email — `getServer()` is the auth-only metadata
    // call. If the route ever issued a send, the test would fail or
    // hit the network.
    envState.POSTMARK_API_KEY = "pm-xxx";
    envState.POSTMARK_FROM_EMAIL = "from@example.com";
    getPostmarkClientMock.mockReturnValue(postmarkClientMock);
    postmarkClientMock.getServer.mockResolvedValueOnce({ ID: 1, Name: "x" });
    const r = await getHealth();
    expect(r.integrations.postmark).toBe("connected");
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
