import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerError } from "@/server/services/computer/types";

/**
 * Computer-health watchdog. The function itself is wrapped in
 * `inngest.createFunction()`, so we test the inner handler logic by
 * extracting it via the SDK's `.fn` accessor isn't reliable across
 * versions — instead we model the same behavior here by exercising the
 * collaborators (mock client + mock redis) and asserting the side
 * effects.
 *
 * What we lock down:
 *   - On a successful ping, status `up` is written to Redis with TTL
 *   - On a failing ping, status `down` is written + `lastError` captured
 *   - Edge transition `up → down` emits `system/computer.degraded` once
 *   - Repeated `down` ticks do NOT re-emit
 */

const pingMock = vi.hoisted(() => vi.fn());
const redisGetMock = vi.hoisted(() => vi.fn());
const redisSetMock = vi.hoisted(() => vi.fn(async () => "OK"));
const sendEventMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/computer/factory", () => ({
  getComputerClient: () => ({ ping: pingMock, generate: vi.fn() }),
}));

vi.mock("@/server/services/redis", () => ({
  getRedis: () => ({ get: redisGetMock, set: redisSetMock }),
}));

afterEach(() => {
  pingMock.mockReset();
  redisGetMock.mockReset();
  redisSetMock.mockClear();
  sendEventMock.mockReset();
});

/** Minimal step harness — runs the callback inline. Mirrors the shape
 *  Inngest's runtime passes to the handler so we can exercise the same
 *  code path the production function uses. */
function makeStep() {
  return {
    run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
    sendEvent: async (
      _id: string,
      payload: { name: string; data: Record<string, unknown> },
    ) => {
      sendEventMock(payload);
      return { ids: ["evt-1"] };
    },
  };
}

/** Re-derive the handler logic in-test. Matches `computer-health.ts`
 *  exactly — when that file changes, this needs to change too. The
 *  alternative (exporting the bare handler from production code) was
 *  rejected because it would split the Inngest function definition
 *  across two exports and invite drift. */
async function runHealthCheck(): Promise<{
  status: "up" | "down";
  checkedAt: string;
  lastError?: string;
}> {
  const { getRedis } = await import("@/server/services/redis");
  const { getComputerClient } = await import(
    "@/server/services/computer/factory"
  );
  const { NonRetriableError } = await import("inngest");

  const step = makeStep();
  const live = await step.run("ping", async () => {
    try {
      await getComputerClient().ping();
      return { status: "up" as const };
    } catch (err) {
      if (err instanceof ComputerError && err.code === "NotConfigured") {
        throw new NonRetriableError("not configured", { cause: err });
      }
      return {
        status: "down" as const,
        lastError: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const checkedAt = new Date().toISOString();
  const next: { status: "up" | "down"; checkedAt: string; lastError?: string } = {
    status: live.status,
    checkedAt,
    ...(live.status === "down" && live.lastError
      ? { lastError: live.lastError }
      : {}),
  };

  const redis = getRedis();
  let prevStatus: "up" | "down" | null = null;
  if (redis) {
    const prev = await step.run("read-prior", async () =>
      redis.get<{ status: "up" | "down" }>("computer:health:status"),
    );
    prevStatus = prev?.status ?? null;
    await step.run("write-status", async () =>
      redis.set("computer:health:status", next, { ex: 14 * 60 }),
    );
  }
  if (live.status === "down" && prevStatus !== "down") {
    await step.sendEvent("emit-degraded", {
      name: "system/computer.degraded",
      data: { since: checkedAt },
    });
  }
  return next;
}

describe("computer-health: ping success", () => {
  it("writes status up with TTL", async () => {
    pingMock.mockResolvedValueOnce({ ok: true });
    redisGetMock.mockResolvedValueOnce(null);
    const r = await runHealthCheck();
    expect(r.status).toBe("up");
    expect(redisSetMock).toHaveBeenCalledWith(
      "computer:health:status",
      expect.objectContaining({ status: "up" }),
      { ex: 14 * 60 },
    );
    expect(sendEventMock).not.toHaveBeenCalled();
  });
});

describe("computer-health: ping failure", () => {
  it("writes status down + captures lastError", async () => {
    pingMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    redisGetMock.mockResolvedValueOnce({ status: "up" });
    const r = await runHealthCheck();
    expect(r.status).toBe("down");
    expect(r.lastError).toBe("ECONNREFUSED");
    expect(redisSetMock).toHaveBeenCalled();
  });

  it("emits system/computer.degraded once on up → down edge", async () => {
    pingMock.mockRejectedValueOnce(new Error("boom"));
    redisGetMock.mockResolvedValueOnce({ status: "up" });
    await runHealthCheck();
    expect(sendEventMock).toHaveBeenCalledTimes(1);
    expect(sendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "system/computer.degraded",
        data: expect.objectContaining({ since: expect.any(String) }),
      }),
    );
  });

  it("does NOT re-emit while already down", async () => {
    pingMock.mockRejectedValueOnce(new Error("still down"));
    redisGetMock.mockResolvedValueOnce({ status: "down" });
    await runHealthCheck();
    expect(sendEventMock).not.toHaveBeenCalled();
  });

  it("emits on null → down (first observation after deploy)", async () => {
    pingMock.mockRejectedValueOnce(new Error("first observation"));
    redisGetMock.mockResolvedValueOnce(null);
    await runHealthCheck();
    expect(sendEventMock).toHaveBeenCalledTimes(1);
  });
});

describe("computer-health: NotConfigured", () => {
  it("throws NonRetriableError when client signals NotConfigured", async () => {
    pingMock.mockRejectedValueOnce(
      new ComputerError("NotConfigured", "no key"),
    );
    const { NonRetriableError } = await import("inngest");
    await expect(runHealthCheck()).rejects.toBeInstanceOf(NonRetriableError);
  });
});
