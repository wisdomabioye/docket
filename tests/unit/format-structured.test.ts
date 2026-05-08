import { describe, expect, it } from "vitest";
import { formatExhibitIndexAsMarkdown } from "@/server/services/output/format-structured";

/**
 * Locked behavior:
 *   - Each entry renders as `### <label> — <filename>` heading +
 *     description paragraph + `**Supports:** <criteria>` bullet.
 *   - Empty `entries` array → friendly "no exhibits indexed yet"
 *     placeholder so the page doesn't paginate blank.
 *   - Malformed JSON → fallback prose with the raw payload preserved
 *     (never throws — a render-path crash would 500 the package
 *     download for the whole case).
 *   - Schema-violating JSON (extra keys, missing required fields) →
 *     same fallback path as malformed JSON.
 *   - Output renders cleanly through `MarkdownRenderer`'s allowlist
 *     (heading + paragraph + ul, no tables — tables would fall to
 *     plain-text fallback).
 */

const VALID_PAYLOAD = JSON.stringify({
  entries: [
    {
      label: "Exhibit A",
      documentId: "doc-1",
      filename: "cv.pdf",
      description: "Curriculum vitae listing 12 peer-reviewed publications.",
      supportsCriteria: [
        "authorship_of_scholarly_articles",
        "original_contributions_of_major_significance",
      ],
    },
    {
      label: "Exhibit B",
      documentId: "doc-2",
      filename: "bauer-prize-letter.pdf",
      description: "Award letter from the Bauer Prize selection committee.",
      supportsCriteria: ["receipt_of_nationally_recognized_awards"],
    },
  ],
});

describe("formatExhibitIndexAsMarkdown", () => {
  it("renders one section per entry with heading + filename + description", () => {
    const md = formatExhibitIndexAsMarkdown(VALID_PAYLOAD);
    expect(md).toContain("### Exhibit A — cv.pdf");
    expect(md).toContain("### Exhibit B — bauer-prize-letter.pdf");
    expect(md).toContain(
      "Curriculum vitae listing 12 peer-reviewed publications.",
    );
    expect(md).toContain(
      "Award letter from the Bauer Prize selection committee.",
    );
  });

  it("renders supportsCriteria as a Markdown bullet, prettified", () => {
    const md = formatExhibitIndexAsMarkdown(VALID_PAYLOAD);
    // Slug `authorship_of_scholarly_articles` →
    // `Authorship of scholarly articles` (capitalize first, underscores → spaces).
    expect(md).toContain("Authorship of scholarly articles");
    // Multiple criteria joined by middle dot for readable inline list.
    expect(md).toContain(
      "**Supports:** Authorship of scholarly articles · Original contributions of major significance",
    );
    // Bullet form so MarkdownRenderer's `list` branch picks it up.
    expect(md).toMatch(/^- \*\*Supports:\*\*/m);
  });

  it("renders a friendly placeholder when entries is empty", () => {
    const md = formatExhibitIndexAsMarkdown(JSON.stringify({ entries: [] }));
    expect(md).toContain("No exhibits indexed yet");
    expect(md).not.toContain("###");
  });

  it("does NOT emit Markdown tables (renderer fallthrough would lose them)", () => {
    const md = formatExhibitIndexAsMarkdown(VALID_PAYLOAD);
    // No pipe-style table separators that the prose-renderer would
    // skip — assert via the row-separator pattern `| --- |`.
    expect(md).not.toMatch(/\|\s*-{3,}\s*\|/);
  });

  it("falls back gracefully on invalid JSON instead of throwing", () => {
    const md = formatExhibitIndexAsMarkdown("{not valid json");
    expect(md).toContain("Could not format exhibit index");
    // Raw payload preserved so attorney can recover.
    expect(md).toContain("{not valid json");
  });

  it("falls back when JSON parses but violates the schema", () => {
    // Missing `entries` (required) + extra top-level key (strict).
    const bad = JSON.stringify({ wrong: "shape" });
    const md = formatExhibitIndexAsMarkdown(bad);
    expect(md).toContain("Could not format exhibit index");
    expect(md).toContain('{"wrong":"shape"}');
  });

  it("escapes inline markdown metacharacters in user-supplied strings", () => {
    // An exhibit label or description containing `*` or `_` would be
    // interpreted as bold/italic by `MarkdownRenderer` and produce
    // unexpected formatting. Assert the formatter neutralizes them.
    const tricky = JSON.stringify({
      entries: [
        {
          label: "Exhibit *A*",
          documentId: "doc-1",
          filename: "snake_case_filename.pdf",
          description: "Description with _underscores_ and *stars*.",
          supportsCriteria: [],
        },
      ],
    });
    const md = formatExhibitIndexAsMarkdown(tricky);
    expect(md).toContain("Exhibit \\*A\\*");
    expect(md).toContain("snake\\_case\\_filename.pdf");
    expect(md).toContain("\\_underscores\\_");
    expect(md).toContain("\\*stars\\*");
  });

  it("omits the supportsCriteria bullet when the array is empty", () => {
    const noCriteria = JSON.stringify({
      entries: [
        {
          label: "Exhibit A",
          documentId: "doc-1",
          filename: "cv.pdf",
          description: "CV.",
          supportsCriteria: [],
        },
      ],
    });
    const md = formatExhibitIndexAsMarkdown(noCriteria);
    expect(md).toContain("### Exhibit A — cv.pdf");
    expect(md).not.toContain("**Supports:**");
  });
});
