import "server-only";
import { randomUUID } from "node:crypto";
import { costForTokens, estimateTokens } from "./pricing";
import {
  ComputerOutputSchema,
  type ComputerClient,
  type ComputerInput,
  type ComputerOutput,
} from "./types";

/**
 * Deterministic mock client. Used when `PERPLEXITY_API_KEY` is unset —
 * which is the dev default until the user provisions a key. Returns a
 * stamped paragraph so anything mock-generated is obvious in UI + logs.
 *
 * Output is deterministic per `(caseId, outputType)` so:
 *   - Snapshot tests don't churn.
 *   - The idempotency partial-unique on `case_outputs(case, type, version)`
 *     can be exercised by re-running the same job — same version → same
 *     content → same row (write rejected by the index, which is the
 *     desired behavior).
 *
 * Token + cost math goes through `pricing.ts` — same constants the real
 * client uses, so the cost ledger reads identically in dev and prod.
 */

const MOCK_LATENCY_MS = 200;

export class MockComputerClient implements ComputerClient {
  async generate(input: ComputerInput): Promise<ComputerOutput> {
    await wait(MOCK_LATENCY_MS);

    const text = generateMockText({
      caseId: input.metadata.caseId,
      outputType: input.metadata.outputType,
      hasJsonSchema: Boolean(input.jsonSchema),
    });

    const promptTokens = estimateTokens(input.systemPrompt + input.userPrompt);
    const completionTokens = estimateTokens(text);
    const usdCents = costForTokens(promptTokens, completionTokens);

    return ComputerOutputSchema.parse({
      text,
      sessionId: `mock-${randomUUID()}`,
      usage: { promptTokens, completionTokens, usdCents },
      provider: "mock",
      metadata: {
        model: "mock-sonar-pro",
        outputType: input.metadata.outputType,
      },
    });
  }

  async ping(): Promise<{ ok: true }> {
    return { ok: true };
  }
}

/** Per-output stamp that makes mock-generated content obvious in the UI
 *  and gives just enough realistic structure (schema-conforming JSON for
 *  the structured outputs / lorem prose for the rest) for downstream
 *  code to render against. */
function generateMockText(args: {
  caseId: string;
  outputType: string;
  hasJsonSchema: boolean;
}): string {
  const stamp = `[MOCK GENERATED — outputType: ${args.outputType}, caseId: ${args.caseId}]`;

  if (args.hasJsonSchema) {
    // The structured-output sub-functions (evidence-plan, exhibit-index,
    // criteria-analysis) re-parse the response with a Zod schema in
    // `_context.ts` / the prompt builders. A generic `{ _mock: true }`
    // payload fails `safeParse`, returns null, and every downstream
    // prompt that depends on it (personal-statement, petition-letter,
    // exhibit-index, recommendation-letter) throws "evidencePlan must
    // be populated". Return per-type minimal-but-conforming payloads.
    const conforming = mockStructuredPayload(args);
    if (conforming) return conforming;
    // Fallback for unknown structured types — keep the legacy shape so
    // any caller that doesn't hard-validate still gets something sensible.
    return JSON.stringify(
      { _mock: true, stamp, caseId: args.caseId, outputType: args.outputType, items: [] },
      null,
      2,
    );
  }

  return [
    stamp,
    "",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do",
    "eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut",
    "enim ad minim veniam, quis nostrud exercitation ullamco laboris",
    "nisi ut aliquip ex ea commodo consequat.",
    "",
    "Duis aute irure dolor in reprehenderit in voluptate velit esse",
    "cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat",
    "cupidatat non proident, sunt in culpa qui officia deserunt mollit",
    "anim id est laborum.",
    "",
    `(Stand-in body for ${args.outputType} on case ${args.caseId}. Real`,
    "Perplexity Sonar output replaces this once PERPLEXITY_API_KEY is set.)",
  ].join("\n");
}

/** Stable timestamp baked into structured mocks. A live `new Date()` would
 *  break the per-(caseId, outputType) determinism the partial-unique
 *  idempotency index depends on; a hardcoded value keeps the same input
 *  → same content invariant regardless of when the build runs. */
const MOCK_GENERATED_AT = "2026-01-01T00:00:00.000Z";

/** Per-output JSON payload that conforms to the corresponding Zod
 *  schema. Returns `null` for outputType we haven't stubbed — the caller
 *  falls back to the generic `_mock` blob. */
function mockStructuredPayload(args: {
  caseId: string;
  outputType: string;
}): string | null {
  switch (args.outputType) {
    case "evidence_plan":
      // Conforms to `EvidencePlanSchema` (server/db/schema/zod/evidence-plan.ts).
      // 8 O-1A criteria — matches `lib/visa-criteria.ts` so attorneys see
      // a familiar shape in dev. visaType is hardcoded "O-1A" because the
      // mock has no access to the case row; Phase 1 only ships O-1A
      // anyway.
      return JSON.stringify({
        visaType: "O-1A",
        overallStrength: "moderate",
        generatedAt: MOCK_GENERATED_AT,
        criteria: [
          { criterion: "Prizes & awards", assessment: "weak", summary: `[MOCK ${args.caseId}] Stand-in assessment for prizes & awards.`, gaps: ["Add awards documentation."] },
          { criterion: "Association membership", assessment: "moderate", summary: "[MOCK] Stand-in association membership summary.", gaps: [] },
          { criterion: "Published material", assessment: "weak", summary: "[MOCK] Press coverage stub.", gaps: ["Identify additional press."] },
          { criterion: "Scholarly contributions", assessment: "moderate", summary: "[MOCK] Publication summary stub.", gaps: [] },
          { criterion: "Peer review", assessment: "absent", summary: "[MOCK] Peer review stub.", gaps: ["Document peer review participation."] },
          { criterion: "Original research", assessment: "moderate", summary: "[MOCK] Original research stub.", gaps: [] },
          { criterion: "Critical role", assessment: "strong", summary: "[MOCK] Critical role stub.", gaps: [] },
          { criterion: "High remuneration", assessment: "weak", summary: "[MOCK] Remuneration stub.", gaps: ["Add salary evidence."] },
        ],
      });
    case "exhibit_index":
      // Conforms to `ExhibitIndexSchema` (server/services/computer/prompts/exhibit-index.ts).
      return JSON.stringify({
        entries: [
          {
            label: "Exhibit A",
            documentId: `mock-doc-${args.caseId.slice(0, 8)}`,
            filename: "mock-stand-in.pdf",
            description: `[MOCK ${args.caseId}] Stand-in exhibit description for the dev pipeline.`,
            supportsCriteria: ["Critical role"],
          },
        ],
      });
    case "criteria_analysis":
      // Generic minimal shape; criteria_analysis isn't currently in the
      // build fan-out, but if a future caller validates with a schema
      // they'll get a parseable payload.
      return JSON.stringify({
        visaType: "O-1A",
        analyses: [],
      });
    default:
      return null;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
