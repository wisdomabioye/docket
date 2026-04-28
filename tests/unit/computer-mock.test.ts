import { describe, expect, it } from "vitest";
import { MockComputerClient } from "@/server/services/computer/mock";
import {
  ComputerOutputSchema,
  type ComputerInput,
} from "@/server/services/computer/types";

/**
 * `MockComputerClient` is the dev default until `PERPLEXITY_API_KEY` is
 * provisioned. It needs to (a) return values that round-trip through
 * `ComputerOutputSchema` (so downstream parsers don't crash in dev),
 * and (b) be deterministic per `(caseId, outputType)` so retries hit
 * the same content (exercises the partial-unique idempotency index).
 */

const baseInput: ComputerInput = {
  systemPrompt: "You are a helpful immigration attorney assistant.",
  userPrompt: "Draft a personal statement for an O-1A petition.",
  metadata: {
    caseId: "11111111-1111-4111-8111-111111111111",
    outputType: "personal_statement",
    sessionId: "test-session-1",
  },
};

describe("MockComputerClient", () => {
  it("returns output that satisfies ComputerOutputSchema", async () => {
    const client = new MockComputerClient();
    const out = await client.generate(baseInput);
    // The mock builds via `ComputerOutputSchema.parse` internally, but
    // re-parsing here documents the contract independently.
    expect(() => ComputerOutputSchema.parse(out)).not.toThrow();
  });

  it("stamps text with the outputType + caseId", async () => {
    const client = new MockComputerClient();
    const out = await client.generate(baseInput);
    expect(out.text).toContain("[MOCK GENERATED");
    expect(out.text).toContain(baseInput.metadata.outputType);
    expect(out.text).toContain(baseInput.metadata.caseId);
  });

  it("uses provider 'mock'", async () => {
    const client = new MockComputerClient();
    const out = await client.generate(baseInput);
    expect(out.provider).toBe("mock");
    expect(out.sessionId).toMatch(/^mock-/);
  });

  it("computes non-zero token + cost estimates from prompt length", async () => {
    const client = new MockComputerClient();
    const out = await client.generate(baseInput);
    expect(out.usage.promptTokens).toBeGreaterThan(0);
    expect(out.usage.completionTokens).toBeGreaterThan(0);
    expect(out.usage.usdCents).toBeGreaterThan(0);
  });

  it("returns JSON when jsonSchema is provided", async () => {
    const client = new MockComputerClient();
    const out = await client.generate({
      ...baseInput,
      jsonSchema: {
        name: "evidence_plan",
        schema: { type: "object", properties: { items: { type: "array" } } },
      },
      metadata: {
        ...baseInput.metadata,
        outputType: "evidence_plan",
      },
    });
    expect(() => JSON.parse(out.text)).not.toThrow();
    const parsed = JSON.parse(out.text) as { _mock: boolean };
    expect(parsed._mock).toBe(true);
  });

  it("ping always resolves ok", async () => {
    const client = new MockComputerClient();
    await expect(client.ping()).resolves.toEqual({ ok: true });
  });

  it("simulates ~200ms latency (lower bound)", async () => {
    const client = new MockComputerClient();
    const start = Date.now();
    await client.generate(baseInput);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(190); // 10ms tolerance
  });
});
