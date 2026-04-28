import { describe, expect, it } from "vitest";
import { requestFromInput } from "@/server/services/computer/http";
import type { ComputerInput } from "@/server/services/computer/types";

/**
 * Per-output search policy is the design's most policy-laden mapping.
 * Test the helper directly so a typo in `disable_search` /
 * `search_domain_filter` / `search_mode` would fail here, not silently
 * be ignored by Sonar.
 */

const baseInput: ComputerInput = {
  systemPrompt: "system",
  userPrompt: "user",
  metadata: {
    caseId: "11111111-1111-4111-8111-111111111111",
    outputType: "evidence_plan",
    sessionId: "test",
  },
};

describe("requestFromInput", () => {
  it("sets model = sonar-pro and stream: false", () => {
    const out = requestFromInput(baseInput);
    expect(out.model).toBe("sonar-pro");
    expect(out.stream).toBe(false);
  });

  it("emits two messages (system + user) in correct order", () => {
    const out = requestFromInput(baseInput);
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0]).toMatchObject({ role: "system", content: "system" });
    expect(out.messages[1]).toMatchObject({ role: "user", content: "user" });
  });

  it("default max_tokens is 4096; explicit override respected", () => {
    expect(requestFromInput(baseInput).max_tokens).toBe(4096);
    expect(
      requestFromInput({ ...baseInput, maxTokens: 12000 }).max_tokens,
    ).toBe(12000);
  });

  it("searchPolicy disabled → disable_search: true; no domain filter", () => {
    const out = requestFromInput({
      ...baseInput,
      searchPolicy: { mode: "disabled" },
    });
    expect(out).toMatchObject({ disable_search: true });
    expect(out).not.toHaveProperty("search_domain_filter");
    expect(out).not.toHaveProperty("search_mode");
  });

  it("searchPolicy web + allowlist → search_domain_filter set", () => {
    const out = requestFromInput({
      ...baseInput,
      searchPolicy: {
        mode: "web",
        domainAllowlist: ["uscis.gov", "justice.gov"],
      },
    });
    expect(out).toMatchObject({
      search_domain_filter: ["uscis.gov", "justice.gov"],
    });
    expect(out).not.toHaveProperty("disable_search");
    expect(out).not.toHaveProperty("search_mode");
  });

  it("searchPolicy web without allowlist → no search params (default web mode)", () => {
    const out = requestFromInput({
      ...baseInput,
      searchPolicy: { mode: "web" },
    });
    expect(out).not.toHaveProperty("disable_search");
    expect(out).not.toHaveProperty("search_domain_filter");
    expect(out).not.toHaveProperty("search_mode");
  });

  it("searchPolicy academic → search_mode: academic", () => {
    const out = requestFromInput({
      ...baseInput,
      searchPolicy: { mode: "academic" },
    });
    expect(out).toMatchObject({ search_mode: "academic" });
    expect(out).not.toHaveProperty("disable_search");
  });

  it("jsonSchema → response_format with json_schema type", () => {
    const out = requestFromInput({
      ...baseInput,
      jsonSchema: {
        name: "evidence_plan",
        schema: { type: "object", properties: { items: { type: "array" } } },
      },
    });
    expect(out.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "evidence_plan",
      },
    });
  });

  it("no jsonSchema → no response_format (default text)", () => {
    const out = requestFromInput(baseInput);
    expect(out).not.toHaveProperty("response_format");
  });
});
