import { describe, expect, it } from "vitest";
import { MockComputerClient } from "@/server/services/computer/mock";
import {
  ComputerOutputSchema,
  type ComputerInput,
} from "@/server/services/computer/types";
import { EvidencePlanSchema } from "@/server/db/schema/zod";
import { ExhibitIndexSchema } from "@/server/services/computer/prompts/exhibit-index";

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

  it("returns evidence_plan JSON that conforms to EvidencePlanSchema", async () => {
    // REGRESSION TEST: prior mock returned `{ _mock: true, ... }`, which
    // failed `EvidencePlanSchema.safeParse` in `loadBuildContext`. That
    // returned `evidencePlan: null`, and every dependent prompt
    // (personal-statement, petition-letter, exhibit-index,
    // recommendation-letter) threw "evidencePlan must be populated".
    // The mock MUST produce a payload that round-trips through the
    // schema or the entire dev-mode build pipeline is broken.
    const client = new MockComputerClient();
    const out = await client.generate({
      ...baseInput,
      jsonSchema: {
        name: "evidence_plan",
        schema: { type: "object" },
      },
      metadata: { ...baseInput.metadata, outputType: "evidence_plan" },
    });
    const parsed: unknown = JSON.parse(out.text);
    const result = EvidencePlanSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.criteria.length).toBeGreaterThan(0);
      expect(result.data.visaType).toBe("O-1A");
    }
  });

  it("returns exhibit_index JSON that conforms to ExhibitIndexSchema", async () => {
    const client = new MockComputerClient();
    const out = await client.generate({
      ...baseInput,
      jsonSchema: { name: "exhibit_index", schema: { type: "object" } },
      metadata: { ...baseInput.metadata, outputType: "exhibit_index" },
    });
    const parsed: unknown = JSON.parse(out.text);
    expect(ExhibitIndexSchema.safeParse(parsed).success).toBe(true);
  });

  it("falls back to a generic _mock blob for unknown structured types", async () => {
    const client = new MockComputerClient();
    const out = await client.generate({
      ...baseInput,
      jsonSchema: { name: "future_thing", schema: { type: "object" } },
      metadata: { ...baseInput.metadata, outputType: "petition_letter" },
    });
    // petition_letter currently uses prose, not JSON — but the test
    // targets the fallback path: any structured outputType we haven't
    // stubbed should still produce parseable JSON, not crash.
    expect(() => JSON.parse(out.text)).not.toThrow();
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
