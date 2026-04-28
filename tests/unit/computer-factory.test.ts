import { describe, expect, it, vi } from "vitest";

/**
 * The factory branches on `env.PERPLEXITY_API_KEY`. We mock the env
 * module so the test can exercise both branches independently. Hoisted
 * via `vi.hoisted` because `vi.mock` factories run before module-scope
 * code.
 *
 * Note on `vi.resetModules()` + `instanceof`: after a reset, re-importing
 * `factory` also re-imports `mock`/`http` with new class identities. So
 * we re-import the class refs through the same dynamic-import call as
 * the factory rather than holding onto top-level imports — otherwise
 * `instanceof` fails on what looks like the same class.
 */

const envState = vi.hoisted(() => ({
  PERPLEXITY_API_KEY: undefined as string | undefined,
}));

vi.mock("@/config/env", () => ({
  env: envState,
}));

describe("getComputerClient", () => {
  it("returns MockComputerClient when PERPLEXITY_API_KEY is unset", async () => {
    envState.PERPLEXITY_API_KEY = undefined;
    vi.resetModules();
    const { getComputerClient } = await import(
      "@/server/services/computer/factory"
    );
    const { MockComputerClient } = await import(
      "@/server/services/computer/mock"
    );
    expect(getComputerClient()).toBeInstanceOf(MockComputerClient);
  });

  it("returns SonarClient when PERPLEXITY_API_KEY is set", async () => {
    envState.PERPLEXITY_API_KEY = "test-pplx-key-not-real";
    vi.resetModules();
    const { getComputerClient } = await import(
      "@/server/services/computer/factory"
    );
    const { SonarClient } = await import("@/server/services/computer/http");
    expect(getComputerClient()).toBeInstanceOf(SonarClient);
  });

  it("re-evaluates on every call (no cached instance)", async () => {
    envState.PERPLEXITY_API_KEY = undefined;
    vi.resetModules();
    const { getComputerClient } = await import(
      "@/server/services/computer/factory"
    );
    const a = getComputerClient();
    const b = getComputerClient();
    // Two distinct instances — the factory recomputes per call so tests
    // can flip env between cases without module reload gymnastics.
    expect(a).not.toBe(b);
  });
});
