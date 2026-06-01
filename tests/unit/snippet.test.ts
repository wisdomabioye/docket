import { describe, expect, it } from "vitest";
import { toSnippet } from "@/lib/snippet";

describe("toSnippet", () => {
  it("strips heading + emphasis markdown to plain prose", () => {
    expect(toSnippet("## Introduction\n\nI, **Dr. Gonzalez**, respectfully…")).toBe(
      "Introduction I, Dr. Gonzalez, respectfully…",
    );
  });

  it("unwraps links and inline code to their text", () => {
    expect(toSnippet("See [Exhibit A](/ex/a) and `Crit. 1`.")).toBe(
      "See Exhibit A and Crit. 1.",
    );
  });

  it("drops fenced code blocks", () => {
    expect(toSnippet("Before\n```\ncode here\n```\nAfter")).toBe("Before After");
  });

  it("collapses whitespace/newlines into single spaces", () => {
    expect(toSnippet("a\n\n  b\t c")).toBe("a b c");
  });

  it("truncates with an ellipsis past maxLen", () => {
    const out = toSnippet("x".repeat(200), 140);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBe(141); // 140 chars + ellipsis
  });

  it("returns short text unchanged (no ellipsis)", () => {
    expect(toSnippet("short and clean")).toBe("short and clean");
  });
});
