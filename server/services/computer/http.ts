import "server-only";
import Perplexity, {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  RateLimitError,
} from "@perplexity-ai/perplexity_ai";
import type { CompletionCreateParamsNonStreaming } from "@perplexity-ai/perplexity_ai/resources/chat/completions";
import { env } from "@/config/env";
import { costForTokens } from "./pricing";
import {
  ComputerError,
  ComputerOutputSchema,
  type ComputerClient,
  type ComputerInput,
  type ComputerOutput,
  type SearchPolicy,
} from "./types";

/**
 * Sonar-backed `ComputerClient`. Wraps `@perplexity-ai/perplexity_ai`'s
 * `client.chat.completions.create()` and adapts the response through
 * `ComputerOutputSchema` so downstream code never sees the SDK's wider
 * type surface directly.
 *
 * Two-step adapter pattern keeps the boundary tight:
 *   1. `requestFromInput()` — build the SDK call params from our shape.
 *   2. `adaptResponse()` — pull the text + citations + cost out of the
 *      SDK response, then `ComputerOutputSchema.parse` to enforce the
 *      contract. A wire-format change from Perplexity fails loudly here.
 *
 * Errors are mapped to typed `ComputerError`s so Inngest sub-functions
 * can decide retry vs. fail-the-case based on `code`. `RateLimited` and
 * `Unavailable` are retryable; `InvalidInput` / `BudgetExceeded` /
 * `NotConfigured` are not. The SDK's retry-with-backoff handles
 * transient network blips; we retry once more at the Inngest layer.
 */

const DEFAULT_MODEL = "sonar-pro";
const DEFAULT_MAX_TOKENS = 4096;

export class SonarClient implements ComputerClient {
  private readonly client: Perplexity;

  constructor() {
    if (!env.PERPLEXITY_API_KEY) {
      throw new ComputerError(
        "NotConfigured",
        "PERPLEXITY_API_KEY is not set — cannot instantiate SonarClient. The factory should have returned MockComputerClient instead.",
      );
    }
    this.client = new Perplexity({ apiKey: env.PERPLEXITY_API_KEY });
  }

  async generate(input: ComputerInput): Promise<ComputerOutput> {
    try {
      const response = await this.client.chat.completions.create(
        requestFromInput(input),
      );
      return adaptResponse(response, input);
    } catch (err) {
      throw mapSdkError(err);
    }
  }

  async ping(): Promise<{ ok: true }> {
    // Cheapest possible call to verify auth + connectivity. 1 token reply.
    try {
      await this.client.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        disable_search: true,
      });
      return { ok: true };
    } catch (err) {
      throw mapSdkError(err);
    }
  }
}

/** Annotated return type forces SDK-shape compliance — a typo in
 *  `disable_search` would fail at the spread instead of being silently
 *  sent to Sonar (and ignored). Same for `search_domain_filter` etc.
 *
 *  Exported for testing — the policy → params mapping is the most
 *  policy-laden translation in this file and warrants direct coverage. */
export function requestFromInput(
  input: ComputerInput,
): CompletionCreateParamsNonStreaming {
  const searchOpts = searchPolicyToOptions(input.searchPolicy);
  const responseFormat = input.jsonSchema
    ? {
        type: "json_schema" as const,
        json_schema: {
          schema: input.jsonSchema.schema,
          name: input.jsonSchema.name,
        },
      }
    : undefined;

  return {
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
    max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    stream: false,
    ...searchOpts,
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };
}

function searchPolicyToOptions(policy: SearchPolicy | undefined) {
  if (!policy || policy.mode === "web") {
    if (policy?.domainAllowlist?.length) {
      return { search_domain_filter: [...policy.domainAllowlist] };
    }
    return {};
  }
  if (policy.mode === "disabled") {
    return { disable_search: true };
  }
  if (policy.mode === "academic") {
    return { search_mode: "academic" as const };
  }
  return {};
}

/** Pull the user-visible text out of the SDK response. The SDK returns
 *  `content` as either a string OR an array of typed chunks (text,
 *  image_url, file_url, pdf_url, video_url). For Sonar text-mode we
 *  expect string; for media-mode (rare in our build pipeline) we join
 *  the text chunks and ignore media chunks. */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: string; text?: string } =>
      typeof c === "object" && c !== null && "type" in c,
    )
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text!)
    .join("");
}

function adaptResponse(
  response: unknown,
  input: ComputerInput,
): ComputerOutput {
  // Defensive: the SDK types have `Stream<...> | StreamChunk` but our
  // call is non-streaming, so the union narrows by structure.
  const r = response as {
    id: string;
    model: string;
    choices: Array<{
      message?: { content?: string | unknown[] | null };
      finish_reason?: string | null;
    }>;
    citations?: string[] | null;
    search_results?: Array<{
      title: string;
      url: string;
      snippet?: string;
      date?: string | null;
      last_updated?: string | null;
      source?: "web" | "attachment";
    }> | null;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: { total_cost?: number };
    } | null;
  };

  const text = extractText(r.choices?.[0]?.message?.content ?? "");
  const promptTokens = r.usage?.prompt_tokens ?? 0;
  const completionTokens = r.usage?.completion_tokens ?? 0;

  // Prefer the provider's reported cost when present — accounting truth
  // beats our local rate calc when the model sees a pricing update.
  // SDK reports `total_cost` in USD (not cents); convert + ceil. Falls
  // back to `costForTokens` (shared with the mock) when omitted.
  const usdCents =
    typeof r.usage?.cost?.total_cost === "number"
      ? Math.ceil(r.usage.cost.total_cost * 100)
      : costForTokens(promptTokens, completionTokens);

  const searchResults = r.search_results?.map((sr) => ({
    title: sr.title,
    url: sr.url,
    ...(sr.snippet ? { snippet: sr.snippet } : {}),
    date: sr.date ?? null,
    lastUpdated: sr.last_updated ?? null,
    ...(sr.source ? { source: sr.source } : {}),
  }));

  return ComputerOutputSchema.parse({
    text,
    sessionId: r.id,
    usage: { promptTokens, completionTokens, usdCents },
    provider: "perplexity-sonar",
    ...(r.citations ? { citations: r.citations } : {}),
    ...(searchResults ? { searchResults } : {}),
    metadata: {
      model: r.model,
      finishReason: r.choices?.[0]?.finish_reason ?? null,
      outputType: input.metadata.outputType,
    },
  });
}

function mapSdkError(err: unknown): ComputerError {
  if (err instanceof ComputerError) return err;
  if (err instanceof RateLimitError) {
    return new ComputerError(
      "RateLimited",
      `Sonar rate-limited: ${err.message}`,
      { cause: err },
    );
  }
  if (err instanceof AuthenticationError) {
    return new ComputerError(
      "NotConfigured",
      `Sonar auth failed — check PERPLEXITY_API_KEY: ${err.message}`,
      { cause: err },
    );
  }
  if (err instanceof BadRequestError) {
    return new ComputerError(
      "InvalidInput",
      `Sonar rejected the request: ${err.message}`,
      { cause: err },
    );
  }
  if (err instanceof APIConnectionTimeoutError) {
    return new ComputerError(
      "Unavailable",
      `Sonar timed out: ${err.message}`,
      { cause: err },
    );
  }
  if (err instanceof APIConnectionError) {
    return new ComputerError(
      "Unavailable",
      `Sonar unreachable: ${err.message}`,
      { cause: err },
    );
  }
  if (err instanceof InternalServerError) {
    return new ComputerError(
      "Unavailable",
      `Sonar internal error: ${err.message}`,
      { cause: err },
    );
  }
  return new ComputerError(
    "Unknown",
    `Sonar call failed: ${err instanceof Error ? err.message : String(err)}`,
    { cause: err },
  );
}
