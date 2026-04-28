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
 *  and gives just enough realistic structure (lorem-ish prose / a JSON
 *  scaffold) for downstream code to render against. */
function generateMockText(args: {
  caseId: string;
  outputType: string;
  hasJsonSchema: boolean;
}): string {
  const stamp = `[MOCK GENERATED — outputType: ${args.outputType}, caseId: ${args.caseId}]`;

  if (args.hasJsonSchema) {
    // The structured-output sub-functions (evidence-plan, exhibit-index,
    // criteria-analysis) parse the response as JSON. Return a minimal
    // skeleton that round-trips through any JSON.parse caller; specific
    // schemas can stub real values once the pipeline integration test
    // pins the shape.
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
