import { describe, expect, it } from "vitest";
import { parseHeadings } from "@/lib/toc";

describe("parseHeadings", () => {
  it("extracts h1–h3 with levels in document order", () => {
    const md = "# Title\n\nintro\n\n## Section A\ntext\n### Sub\n## Section B";
    expect(parseHeadings(md)).toEqual([
      { level: 1, text: "Title" },
      { level: 2, text: "Section A" },
      { level: 3, text: "Sub" },
      { level: 2, text: "Section B" },
    ]);
  });

  it("ignores h4+ and non-heading lines", () => {
    expect(parseHeadings("#### Too deep\nplain line\n## Real")).toEqual([
      { level: 2, text: "Real" },
    ]);
  });

  it("strips inline emphasis/code so text matches the rendered <h*>", () => {
    expect(parseHeadings("## **Bold** and `code`")).toEqual([
      { level: 2, text: "Bold and code" },
    ]);
  });

  it("skips '#' lines inside fenced code blocks", () => {
    const md = "## Real\n```\n# not a heading\n```\n## Also real";
    expect(parseHeadings(md)).toEqual([
      { level: 2, text: "Real" },
      { level: 2, text: "Also real" },
    ]);
  });

  it("strips trailing closing-hash markers", () => {
    expect(parseHeadings("## Centered ##")).toEqual([
      { level: 2, text: "Centered" },
    ]);
  });

  it("returns empty for content with no headings (e.g. JSON)", () => {
    expect(parseHeadings('{"exhibits":[]}')).toEqual([]);
  });
});
