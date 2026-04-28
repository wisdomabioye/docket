import { describe, expect, it, vi } from "vitest";
import {
  RateLimitError,
  AuthenticationError,
  BadRequestError,
  APIConnectionError,
  APIConnectionTimeoutError,
  InternalServerError,
} from "@perplexity-ai/perplexity_ai";

/**
 * `SonarClient` boundary tests. Real network would be expensive +
 * flaky; we mock the SDK's `chat.completions.create` and assert the
 * adapter pulls the right text/citations/cost out, AND that errors
 * map to typed `ComputerError`s with the right `code` so Inngest
 * sub-functions can decide retry vs. fail.
 *
 * Pattern: vi.mock the entire SDK so every `new Perplexity(...)` in
 * the module under test gets a stubbed client.
 */

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("@perplexity-ai/perplexity_ai", async () => {
  const actual = await vi.importActual<
    typeof import("@perplexity-ai/perplexity_ai")
  >("@perplexity-ai/perplexity_ai");
  // `new Perplexity(...)` is a constructor; return a class so `new`
  // works. `vi.fn().mockImplementation(...)` produces a regular function
  // and `new` on it crashes ("not a constructor").
  class MockPerplexity {
    chat = { completions: { create: mockCreate } };
  }
  return {
    ...actual,
    default: MockPerplexity,
  };
});

const envState = vi.hoisted(() => ({
  PERPLEXITY_API_KEY: "test-key" as string | undefined,
}));
vi.mock("@/config/env", () => ({ env: envState }));

import { SonarClient } from "@/server/services/computer/http";
import {
  ComputerError,
  type ComputerInput,
} from "@/server/services/computer/types";

const baseInput: ComputerInput = {
  systemPrompt: "system",
  userPrompt: "user",
  metadata: {
    caseId: "11111111-1111-4111-8111-111111111111",
    outputType: "personal_statement",
    sessionId: "test",
  },
};

describe("SonarClient.generate (mocked SDK)", () => {
  it("adapts a happy-path response into ComputerOutput", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "resp-abc",
      model: "sonar-pro",
      created: 1_700_000_000,
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Generated petition draft text.",
          },
          finish_reason: "stop",
        },
      ],
      citations: ["https://uscis.gov/forms/i-129"],
      search_results: [
        {
          title: "USCIS Form I-129",
          url: "https://uscis.gov/forms/i-129",
          snippet: "Use this form to petition...",
          source: "web",
        },
      ],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500,
        cost: { total_cost: 0.0105 }, // $0.0105 = 2 cents (ceil)
      },
    });

    const client = new SonarClient();
    const out = await client.generate(baseInput);

    expect(out.text).toBe("Generated petition draft text.");
    expect(out.sessionId).toBe("resp-abc");
    expect(out.provider).toBe("perplexity-sonar");
    expect(out.usage.promptTokens).toBe(1000);
    expect(out.usage.completionTokens).toBe(500);
    expect(out.usage.usdCents).toBe(2); // ceil(0.0105 * 100) = 2
    expect(out.citations).toEqual(["https://uscis.gov/forms/i-129"]);
    expect(out.searchResults).toHaveLength(1);
    expect(out.searchResults?.[0]?.url).toBe("https://uscis.gov/forms/i-129");
    expect(out.metadata).toMatchObject({
      model: "sonar-pro",
      finishReason: "stop",
      outputType: "personal_statement",
    });
  });

  it("falls back to local cost calc when usage.cost is omitted", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "resp-no-cost",
      model: "sonar-pro",
      created: 1_700_000_000,
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "x" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 100_000, total_tokens: 1_100_000 },
    });

    const client = new SonarClient();
    const out = await client.generate(baseInput);
    // 1M input × $3/1M = 300¢; 100k output × $15/1M = 150¢; total 450¢.
    expect(out.usage.usdCents).toBe(450);
  });

  it("joins chunked text content into a single string", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "resp-chunked",
      model: "sonar-pro",
      created: 1_700_000_000,
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "First chunk. " },
              { type: "text", text: "Second chunk." },
              { type: "image_url", image_url: { url: "https://x" } }, // ignored
            ],
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });

    const client = new SonarClient();
    const out = await client.generate(baseInput);
    expect(out.text).toBe("First chunk. Second chunk.");
  });

  it("maps RateLimitError → ComputerError(RateLimited, retryable)", async () => {
    mockCreate.mockRejectedValueOnce(new RateLimitError(429, undefined, "rate limited", new Headers()));
    const client = new SonarClient();
    await expect(client.generate(baseInput)).rejects.toMatchObject({
      name: "ComputerError",
      code: "RateLimited",
      retryable: true,
    });
  });

  it("maps AuthenticationError → ComputerError(NotConfigured, non-retryable)", async () => {
    mockCreate.mockRejectedValueOnce(new AuthenticationError(401, undefined, "bad key", new Headers()));
    const client = new SonarClient();
    await expect(client.generate(baseInput)).rejects.toMatchObject({
      code: "NotConfigured",
      retryable: false,
    });
  });

  it("maps BadRequestError → ComputerError(InvalidInput, non-retryable)", async () => {
    mockCreate.mockRejectedValueOnce(new BadRequestError(400, undefined, "bad request", new Headers()));
    const client = new SonarClient();
    await expect(client.generate(baseInput)).rejects.toMatchObject({
      code: "InvalidInput",
      retryable: false,
    });
  });

  it("maps APIConnectionError → ComputerError(Unavailable, retryable)", async () => {
    mockCreate.mockRejectedValueOnce(
      new APIConnectionError({ message: "ECONNREFUSED" }),
    );
    const client = new SonarClient();
    await expect(client.generate(baseInput)).rejects.toMatchObject({
      code: "Unavailable",
      retryable: true,
    });
  });

  it("maps APIConnectionTimeoutError → ComputerError(Unavailable, retryable)", async () => {
    mockCreate.mockRejectedValueOnce(
      new APIConnectionTimeoutError({ message: "timeout" }),
    );
    const client = new SonarClient();
    await expect(client.generate(baseInput)).rejects.toMatchObject({
      code: "Unavailable",
      retryable: true,
    });
  });

  it("maps InternalServerError → ComputerError(Unavailable, retryable)", async () => {
    mockCreate.mockRejectedValueOnce(
      new InternalServerError(500, undefined, "boom", new Headers()),
    );
    const client = new SonarClient();
    await expect(client.generate(baseInput)).rejects.toMatchObject({
      code: "Unavailable",
      retryable: true,
    });
  });

  it("falls through unknown errors as ComputerError(Unknown, retryable)", async () => {
    mockCreate.mockRejectedValueOnce(new Error("mystery"));
    const client = new SonarClient();
    await expect(client.generate(baseInput)).rejects.toMatchObject({
      code: "Unknown",
      retryable: true,
    });
  });
});

describe("SonarClient constructor", () => {
  it("throws ComputerError(NotConfigured) when API key is unset", () => {
    envState.PERPLEXITY_API_KEY = undefined;
    expect(() => new SonarClient()).toThrow(ComputerError);
    envState.PERPLEXITY_API_KEY = "test-key"; // restore for other tests
  });
});
