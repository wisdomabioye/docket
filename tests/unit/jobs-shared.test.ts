import { describe, expect, it, vi } from "vitest";
import { NonRetriableError } from "inngest";
import {
  ComputerError,
  type ComputerOutput,
} from "@/server/services/computer/types";
import { AppError } from "@/lib/errors";

/**
 * `runOutputJob` is the per-output runner shared by all 5 sub-functions.
 * The DB-touching path is covered by the integration test; this file
 * locks the error-classification rules — every retryable vs.
 * non-retryable decision the parent build pipeline depends on.
 */

const generateMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const txMock = vi.hoisted(() =>
  vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
);

vi.mock("@/server/services/computer/factory", () => ({
  getComputerClient: () => ({
    generate: generateMock,
    ping: vi.fn(),
  }),
}));

vi.mock("@/server/services/output", () => ({
  saveOutputVersion: saveMock,
}));

vi.mock("@/server/db/client", () => ({
  db: { transaction: txMock },
}));

const happyOutput: ComputerOutput = {
  text: "draft",
  sessionId: "sess-1",
  usage: { promptTokens: 10, completionTokens: 20, usdCents: 5 },
  provider: "mock",
};

const promptStub = {
  systemPrompt: "sys",
  userPrompt: "usr",
};

async function callRunner(args?: {
  generateRejection?: unknown;
  saveRejection?: unknown;
}): Promise<unknown> {
  generateMock.mockReset();
  saveMock.mockReset();
  if (args?.generateRejection !== undefined) {
    generateMock.mockRejectedValueOnce(args.generateRejection);
  } else {
    generateMock.mockResolvedValueOnce(happyOutput);
  }
  if (args?.saveRejection !== undefined) {
    saveMock.mockRejectedValueOnce(args.saveRejection);
  } else {
    saveMock.mockResolvedValueOnce({
      outputId: "out-1",
      outputVersion: 1,
      newSpendCents: 5n,
    });
  }
  const { runOutputJob } = await import("@/server/jobs/_shared");
  return runOutputJob({
    caseId: "c1",
    outputType: "evidence_plan",
    prompt: promptStub,
    sessionId: "sess",
  });
}

describe("runOutputJob — happy path", () => {
  it("returns a JSON-safe result (newSpendCents stringified)", async () => {
    const r = (await callRunner()) as Record<string, unknown>;
    expect(r).toEqual({
      outputId: "out-1",
      outputVersion: 1,
      newSpendCents: "5",
      costCents: 5,
      computerSessionId: "sess-1",
    });
  });

  it("forwards prompt fields + telemetry metadata to generate", async () => {
    await callRunner();
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "sys",
        userPrompt: "usr",
        metadata: { caseId: "c1", outputType: "evidence_plan", sessionId: "sess" },
      }),
    );
  });
});

describe("runOutputJob — error classification", () => {
  it("ComputerError(retryable=false) → NonRetriableError", async () => {
    await expect(
      callRunner({
        generateRejection: new ComputerError("InvalidInput", "bad"),
      }),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });

  it("ComputerError(NotConfigured) → NonRetriableError", async () => {
    await expect(
      callRunner({
        generateRejection: new ComputerError("NotConfigured", "no key"),
      }),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });

  it("ComputerError(BudgetExceeded) → NonRetriableError", async () => {
    await expect(
      callRunner({
        generateRejection: new ComputerError("BudgetExceeded", "over"),
      }),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });

  it("ComputerError(RateLimited) → propagates (Inngest retries)", async () => {
    await expect(
      callRunner({
        generateRejection: new ComputerError("RateLimited", "429"),
      }),
    ).rejects.toBeInstanceOf(ComputerError);
  });

  it("ComputerError(Unavailable) → propagates", async () => {
    await expect(
      callRunner({
        generateRejection: new ComputerError("Unavailable", "down"),
      }),
    ).rejects.toBeInstanceOf(ComputerError);
  });

  it("ComputerError(Unknown) → propagates", async () => {
    await expect(
      callRunner({
        generateRejection: new ComputerError("Unknown", "?"),
      }),
    ).rejects.toBeInstanceOf(ComputerError);
  });

  it("save-time AppError(BAD_REQUEST) → NonRetriableError (budget guard)", async () => {
    await expect(
      callRunner({
        saveRejection: new AppError("BAD_REQUEST", "compute budget exceeded"),
      }),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });

  it("save-time AppError(NOT_FOUND) → propagates (Inngest retries)", async () => {
    // NOT_FOUND on the case row could be a transient race; let Inngest
    // retry once before giving up.
    await expect(
      callRunner({
        saveRejection: new AppError("NOT_FOUND", "case missing"),
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("non-Error rejections get wrapped (no swallowing)", async () => {
    await expect(callRunner({ generateRejection: "string-rejection" }))
      .rejects.toBeInstanceOf(Error);
  });
});
