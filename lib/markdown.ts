import { Marked } from "marked";
import sanitizeHtmlLib from "sanitize-html";
import TurndownService from "turndown";

/**
 * Markdown ↔ HTML conversion + allowlist sanitization for Stage 08
 * output editing.
 *
 * Canonical form: markdown (`case_outputs.content`). The Tiptap editor
 * works in HTML; we convert markdown → HTML for editing/rendering and
 * HTML → markdown on save. The cached `case_outputs.content_html`
 * column lets reads skip the `marked` round-trip per request.
 *
 * Sanitization runs AFTER `marked.parse` and AFTER `turndown` rejects
 * un-allowlisted nodes — defense in depth. Spec §17 requires the
 * allowlist (p, h1-h4, strong, em, ul, ol, li, blockquote, sup, a) and
 * `http(s)://`-only `href` schemes.
 *
 * Module-singleton instances of `Marked` + `TurndownService` so the
 * per-call cost is just `parse()` / `turndown()`. Helpers are pure:
 * same input → same output (no IO, no env reads, no random).
 */

const ALLOWED_TAGS: ReadonlyArray<string> = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "blockquote",
  "sup",
  "a",
];

/** `marked` instance configured for legal-prose constraints:
 *  - GFM disabled — we don't want tables/strikethrough/task-lists in
 *    petition letters.
 *  - `breaks: false` — single newlines are NOT line breaks; legal docs
 *    use blank lines for paragraph separation.
 *  - Synchronous output (`async: false`).
 *
 *  Raw HTML in markdown source is parsed by marked and emitted as
 *  inline HTML; the sanitizer downstream is the gate that drops
 *  anything outside the allowlist. */
const marked = new Marked({
  gfm: false,
  breaks: false,
  async: false,
});

/** `turndown` instance configured for round-trip stability:
 *  - `headingStyle: "atx"` — `#` headings, never underline-style.
 *  - `codeBlockStyle: "fenced"` — ``` ``` blocks (consistency with
 *    Stage 07 model output).
 *  - `bulletListMarker: "-"`, `emDelimiter: "*"`, `strongDelimiter: "**"`
 *    so two saves of the same content produce a stable byte-for-byte
 *    diff (matters for version-history readability).
 *
 *  `<sup>` is preserved by adding a custom rule — turndown's defaults
 *  drop unknown tags, which would erase footnote refs.
 */
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
  hr: "---",
});

turndown.addRule("preserveSup", {
  filter: ["sup"],
  replacement: (content: string) => `<sup>${content}</sup>`,
});

/**
 * Markdown source → rendered HTML. Output is NOT yet sanitized — call
 * `sanitizeHtml` before sending to a browser or PDF renderer. Returns
 * an empty string for empty/whitespace input (matches `case_outputs`'s
 * convention that "no content" reads as `""`, not `<p></p>`).
 */
export function mdToHtml(md: string): string {
  if (!md || md.trim().length === 0) return "";
  // `marked.parse` with `async: false` returns string synchronously.
  // Cast through `unknown` to satisfy strict TS without `any`.
  const result = marked.parse(md) as unknown;
  return typeof result === "string" ? result : "";
}

/**
 * Tiptap-style HTML → markdown source. Saved to `case_outputs.content`.
 *
 * Empty/whitespace input → empty string (the calling service rejects
 * empty content as a save attempt).
 */
export function htmlToMd(html: string): string {
  if (!html || html.trim().length === 0) return "";
  return turndown.turndown(html);
}

/**
 * Strict allowlist sanitizer. Drops anything outside `ALLOWED_TAGS`,
 * strips all attributes except `href` on `<a>` (with scheme allowlist),
 * and forbids the `javascript:` / `data:` URL classes that browser
 * URL-rendering would happily execute.
 *
 * Used:
 *   - On every server-side render of `case_outputs.content_html`.
 *   - As a final filter on attorney saves (defense in depth — Tiptap's
 *     schema already constrains nodes, but a paste from Word can sneak
 *     through `<style>` / `<script>` blocks that TipTap discards
 *     visually but might leave in the serialized HTML).
 */
export function sanitizeHtml(html: string): string {
  if (!html || html.length === 0) return "";
  return sanitizeHtmlLib(html, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: {
      a: ["href"],
    },
    // Allow only http/https for `href`; everything else (`javascript:`,
    // `data:`, `vbscript:`, relative URLs without scheme, etc.) is
    // dropped silently.
    allowedSchemes: ["http", "https"],
    allowedSchemesByTag: {
      a: ["http", "https"],
    },
    // Reject schemes-relative (`//evil.com/x`) — without an explicit
    // scheme, the browser inherits the page's, which we don't want for
    // legal documents (the link should be unambiguous).
    allowProtocolRelative: false,
    // No nested allow lists — we don't expose data-* or aria-* in this
    // surface; legal prose doesn't need them.
    allowedClasses: {},
    // Strict mode: drop <style>, <script>, <iframe>, etc. (default).
    disallowedTagsMode: "discard",
  });
}

/** Convenience: markdown source → safe-to-render HTML. The combined
 *  call is what the output service (`updateOutputContent`) and the
 *  render layer use; expose it so callers don't need to remember the
 *  pipeline order. */
export function mdToSafeHtml(md: string): string {
  return sanitizeHtml(mdToHtml(md));
}
