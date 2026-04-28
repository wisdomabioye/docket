import "server-only";
import { z } from "zod";
import { outputTypeEnum } from "@/server/db/schema";

/**
 * `ComputerClient` is the abstraction the build pipeline talks to. The
 * real implementation calls Perplexity Sonar; the mock implementation
 * returns deterministic stamped text. Both produce values that satisfy
 * `ComputerOutputSchema`, so downstream code (Inngest sub-functions,
 * `saveOutputVersion`, the cost ledger) is provider-agnostic.
 *
 * Why Zod at this boundary: the SDK's response type is wide and includes
 * fields we don't care about. Parsing through the schema validates the
 * shape we depend on AND strips unknown fields, so a Perplexity wire
 * change can only break us at the adapter — not silently corrupt a row
 * downstream.
 *
 * Why `usdCents: number` (not bigint): cost-per-call rounds to single-
 * dollar precision well below `Number.MAX_SAFE_INTEGER`. The aggregated
 * `cases.compute_spent_cents` IS bigint (matches money convention); we
 * coerce on insert in `saveOutputVersion`.
 */

const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string().optional(),
  date: z.string().nullish(),
  lastUpdated: z.string().nullish(),
  source: z.enum(["web", "attachment"]).optional(),
});

export const ComputerOutputSchema = z.object({
  /** The model's prose response. Joined to a single string when the SDK
   *  returns chunked content (text + image + file blocks). */
  text: z.string(),
  /** Provider-side response id. `mock-${uuid}` for the mock client. */
  sessionId: z.string(),
  usage: z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    /** Cost in USD cents, rounded up. */
    usdCents: z.number().int().nonnegative(),
  }),
  provider: z.enum(["perplexity-sonar", "mock"]),
  /** URLs grounded against (Sonar's `citations[]`). */
  citations: z.array(z.string()).optional(),
  /** Structured search results (Sonar's `search_results[]`). */
  searchResults: z.array(SearchResultSchema).optional(),
  /** Free-form pass-through (model name, finish reason, etc). */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ComputerOutput = z.infer<typeof ComputerOutputSchema>;

export type OutputType = (typeof outputTypeEnum.enumValues)[number];

/**
 * Per-output search policy. Set per prompt builder so the "personal
 * statement" call disables web search while the "petition letter" call
 * locks to USCIS-adjacent domains. See `prompts/*.ts` for the bindings.
 */
export type SearchPolicy =
  | { mode: "disabled" }
  | { mode: "web"; domainAllowlist?: readonly string[] }
  | { mode: "academic" };

export type ComputerInput = {
  systemPrompt: string;
  userPrompt: string;
  /** When set, Sonar's `response_format: { type: "json_schema" }` is used. */
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
  searchPolicy?: SearchPolicy;
  /** Cap on output tokens. Default 4096 (~12k chars) per call. */
  maxTokens?: number;
  /** Telemetry only — never sent to the provider. */
  metadata: {
    caseId: string;
    outputType: OutputType;
    /** Stable id for this generation attempt (used for log correlation). */
    sessionId: string;
  };
};

/**
 * Discriminated error from the client. Inngest sub-functions inspect
 * `code` to decide whether to retry, fall through to the (deferred)
 * fallback policy, or fail the case to `build_failed`.
 */
export type ComputerErrorCode =
  | "RateLimited"
  | "Unavailable"
  | "InvalidInput"
  | "BudgetExceeded"
  | "NotConfigured"
  | "Unknown";

export class ComputerError extends Error {
  readonly code: ComputerErrorCode;
  readonly retryable: boolean;
  override readonly cause?: unknown;
  constructor(code: ComputerErrorCode, message: string, opts?: { retryable?: boolean; cause?: unknown }) {
    super(message);
    this.name = "ComputerError";
    this.code = code;
    this.retryable = opts?.retryable ?? defaultRetryable(code);
    if (opts?.cause !== undefined) this.cause = opts.cause;
  }
}

function defaultRetryable(code: ComputerErrorCode): boolean {
  switch (code) {
    case "RateLimited":
    case "Unavailable":
    case "Unknown":
      return true;
    case "InvalidInput":
    case "BudgetExceeded":
    case "NotConfigured":
      return false;
  }
}

export interface ComputerClient {
  generate(input: ComputerInput): Promise<ComputerOutput>;
  /** Health probe — should be cheap and side-effect-free. Throws to
   *  signal degradation; the scheduled health job catches and writes
   *  Redis. */
  ping(): Promise<{ ok: true }>;
}

/**
 * Reserved interface for the deferred provider-fallback chain. Stage 07
 * ships with `null` policy; the composite client returns the primary
 * client's error directly. Stage 11+ may wire a second provider here
 * (open_issues #19).
 */
export interface FallbackPolicy {
  shouldFallback(err: ComputerError): boolean;
}
