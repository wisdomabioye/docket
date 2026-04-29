import { describe, expect, it } from "vitest";
import {
  htmlToMd,
  mdToHtml,
  mdToSafeHtml,
  sanitizeHtml,
} from "@/lib/markdown";

/**
 * Stage 08 markdown helpers.
 *
 * Two test surfaces:
 *   1. `mdToHtml` / `htmlToMd` round-trip — Tiptap edits land as HTML,
 *      we serialize back to markdown, store in `case_outputs.content`.
 *      The next read converts back to HTML for display. Round-trip
 *      stability matters for version-history diff readability.
 *   2. `sanitizeHtml` allowlist — spec §17 mandates the strict tag set
 *      and `http(s)://`-only `href` schemes.
 */

describe("mdToHtml", () => {
  it("returns empty string for empty/whitespace input", () => {
    expect(mdToHtml("")).toBe("");
    expect(mdToHtml("   \n   ")).toBe("");
  });

  it("renders paragraphs", () => {
    const html = mdToHtml("Hello world.\n\nSecond paragraph.");
    expect(html).toContain("<p>Hello world.</p>");
    expect(html).toContain("<p>Second paragraph.</p>");
  });

  it("renders bold and italic", () => {
    expect(mdToHtml("**bold**")).toContain("<strong>bold</strong>");
    expect(mdToHtml("*italic*")).toContain("<em>italic</em>");
  });

  it("renders ordered and unordered lists", () => {
    const ul = mdToHtml("- one\n- two");
    expect(ul).toContain("<ul>");
    expect(ul).toContain("<li>one</li>");
    const ol = mdToHtml("1. first\n2. second");
    expect(ol).toContain("<ol>");
    expect(ol).toContain("<li>first</li>");
  });

  it("renders blockquotes and headings", () => {
    expect(mdToHtml("# Title")).toContain("<h1>Title</h1>");
    expect(mdToHtml("> Quote")).toContain("<blockquote>");
  });

  it("renders inline links", () => {
    const html = mdToHtml("[USCIS](https://uscis.gov)");
    expect(html).toContain('<a href="https://uscis.gov">USCIS</a>');
  });
});

describe("htmlToMd", () => {
  it("returns empty string for empty/whitespace input", () => {
    expect(htmlToMd("")).toBe("");
    expect(htmlToMd("   ")).toBe("");
  });

  it("converts paragraphs back to markdown", () => {
    const md = htmlToMd("<p>Hello world.</p><p>Second paragraph.</p>");
    expect(md).toContain("Hello world.");
    expect(md).toContain("Second paragraph.");
  });

  it("preserves bold/italic markers", () => {
    expect(htmlToMd("<p><strong>bold</strong></p>")).toContain("**bold**");
    expect(htmlToMd("<p><em>italic</em></p>")).toContain("*italic*");
  });

  it("preserves <sup> tags inline (footnote refs)", () => {
    const md = htmlToMd("<p>cite<sup>1</sup>.</p>");
    expect(md).toContain("<sup>1</sup>");
  });

  it("converts headings to ATX style", () => {
    expect(htmlToMd("<h1>Title</h1>")).toContain("# Title");
    expect(htmlToMd("<h2>Sub</h2>")).toContain("## Sub");
  });
});

describe("md ↔ html round-trip stability", () => {
  it("paragraphs round-trip", () => {
    const src = "Hello world.\n\nSecond paragraph.";
    const back = htmlToMd(mdToHtml(src)).trim();
    expect(back).toBe("Hello world.\n\nSecond paragraph.");
  });

  it("bold/italic round-trip", () => {
    const src = "Some **bold** and *italic* text.";
    const back = htmlToMd(mdToHtml(src)).trim();
    expect(back).toBe(src);
  });

  it("ordered list round-trip preserves numbering", () => {
    const src = "1. first\n2. second";
    const back = htmlToMd(mdToHtml(src)).trim();
    // Turndown normalizes to "1.  first" with double spaces.
    expect(back).toMatch(/^1\.\s+first/);
    expect(back).toMatch(/2\.\s+second/);
  });

  it("links round-trip", () => {
    const src = "[USCIS](https://uscis.gov)";
    const back = htmlToMd(mdToHtml(src)).trim();
    expect(back).toBe("[USCIS](https://uscis.gov)");
  });

  it("two saves of unchanged content produce stable byte-equal output", () => {
    const src = "**Petition** for [USCIS](https://uscis.gov) review.\n\n- Item one\n- Item two";
    const once = htmlToMd(mdToHtml(src));
    const twice = htmlToMd(mdToHtml(once));
    expect(twice).toBe(once);
  });
});

describe("sanitizeHtml — allowlist", () => {
  it("returns empty string for empty input", () => {
    expect(sanitizeHtml("")).toBe("");
  });

  it("preserves all allow-listed tags", () => {
    const html =
      "<p>P</p><h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4>" +
      "<strong>B</strong><em>I</em>" +
      "<ul><li>U</li></ul><ol><li>O</li></ol>" +
      "<blockquote>Q</blockquote><sup>S</sup>" +
      '<a href="https://x.io">L</a>';
    const safe = sanitizeHtml(html);
    for (const tag of ["p", "h1", "h2", "h3", "h4", "strong", "em", "ul", "ol", "li", "blockquote", "sup", "a"]) {
      expect(safe).toContain(`<${tag}`);
    }
  });

  it("strips disallowed tags (script, style, iframe, img)", () => {
    const html =
      '<p>OK</p><script>alert(1)</script><style>body{}</style>' +
      '<iframe src="x"></iframe><img src="x.png">';
    const safe = sanitizeHtml(html);
    expect(safe).toContain("<p>OK</p>");
    expect(safe).not.toContain("<script");
    expect(safe).not.toContain("<style");
    expect(safe).not.toContain("<iframe");
    expect(safe).not.toContain("<img");
  });

  it("strips style/class/id attributes from kept tags", () => {
    const html = '<p style="color:red" class="evil" id="hack">x</p>';
    const safe = sanitizeHtml(html);
    expect(safe).not.toContain("style");
    expect(safe).not.toContain("class");
    expect(safe).not.toContain("id=");
  });
});

describe("sanitizeHtml — href scheme guard", () => {
  it("allows http and https hrefs", () => {
    expect(sanitizeHtml('<a href="http://x.io">x</a>')).toContain(
      'href="http://x.io"',
    );
    expect(sanitizeHtml('<a href="https://x.io">x</a>')).toContain(
      'href="https://x.io"',
    );
  });

  it("strips javascript: hrefs", () => {
    const safe = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(safe).not.toContain("javascript:");
  });

  it("strips data: hrefs", () => {
    const safe = sanitizeHtml(
      '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    );
    expect(safe).not.toContain("data:");
  });

  it("strips vbscript: and other schemes", () => {
    const safe = sanitizeHtml('<a href="vbscript:msgbox(1)">x</a>');
    expect(safe).not.toContain("vbscript:");
  });

  it("strips schema-relative URLs (//evil.com)", () => {
    // schema-relative would inherit the page's scheme; we want every
    // link explicit so attorneys can verify destinations at a glance.
    const safe = sanitizeHtml('<a href="//evil.com/x">x</a>');
    expect(safe).not.toContain("//evil.com");
  });
});

describe("mdToSafeHtml — combined pipeline", () => {
  it("strips raw <script> embedded in markdown source", () => {
    const md = "Hello.\n\n<script>alert(1)</script>\n\nWorld.";
    const safe = mdToSafeHtml(md);
    expect(safe).not.toContain("<script");
    expect(safe).toContain("Hello.");
    expect(safe).toContain("World.");
  });

  it("strips raw HTML <iframe> embedded in markdown source", () => {
    const md = 'Read [this](https://x.io).\n\n<iframe src="evil"></iframe>';
    const safe = mdToSafeHtml(md);
    expect(safe).not.toContain("<iframe");
    expect(safe).toContain('href="https://x.io"');
  });

  it("strips javascript: link from markdown source", () => {
    const md = "[click](javascript:alert(1))";
    const safe = mdToSafeHtml(md);
    expect(safe).not.toContain("javascript:");
  });
});
