import "server-only";
import { ExhibitIndexSchema } from "@/server/services/computer/prompts/exhibit-index";

/**
 * Server-side formatters that turn structured-output JSON
 * (`case_outputs.content` for output types whose prompt is JSON-mode)
 * into attorney-readable markdown for display + PDF rendering.
 *
 * The canonical storage shape stays JSON — `_context.ts` parses it for
 * downstream prompt builders, version history snapshots it, restore
 * copies it forward. The formatter is a render-time transform; nothing
 * writes formatted markdown back into `content`.
 *
 * Output is shaped to round-trip cleanly through `MarkdownRenderer`
 * (headings, paragraphs, unordered lists). Markdown tables are NOT
 * used — the renderer's `default` branch falls through tables to plain
 * text fallback (see `pdf/markdown-renderer.tsx`).
 *
 * Malformed input fallback: if `JSON.parse` or `safeParse` fails, the
 * formatter returns a brief "could not format — raw output below"
 * preamble plus the raw content fenced as a paragraph. Renders rather
 * than crashes; attorney sees the raw shape and can Regenerate. (We
 * never throw — a render-path crash in the package compiler would
 * 500 the download for the entire case.)
 */

/** Internal helper — turn a slug-ish criterion id into something more
 *  readable in the rendered markdown. The model emits identifiers like
 *  `original_contributions_of_major_significance_in_field`; humans want
 *  "Original contributions of major significance in field". */
function prettifyCriterion(slug: string): string {
  const trimmed = slug.trim();
  if (trimmed.length === 0) return slug;
  const spaced = trimmed.replace(/[_\\]/g, " ").replace(/\s+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Light escape for free-form strings landing in markdown. Inline
 *  characters that markdown would interpret get a `\` prefix so the
 *  rendered prose doesn't accidentally bold/italicize. We don't try
 *  to escape every metacharacter — only the high-impact ones for the
 *  shapes the model produces (paragraphs + key/value lines). */
function escapeInlineMarkdown(s: string): string {
  return s.replace(/([*_`])/g, "\\$1");
}

/**
 * Render an exhibit-index JSON payload as markdown.
 *
 * Per-entry shape:
 *
 *   ### Exhibit A — filename.pdf
 *
 *   <description>
 *
 *   - **Supports:** Criterion one · Criterion two
 *
 * Empty entries → a single "No exhibits indexed yet — regenerate after
 * uploading evidence." line so the page never paginates blank.
 */
export function formatExhibitIndexAsMarkdown(json: string): string {
  const parsed = safeParseExhibitIndex(json);
  if (!parsed) return formatRawFallback(json, "exhibit index");

  if (parsed.entries.length === 0) {
    return "_No exhibits indexed yet — regenerate after uploading evidence._";
  }

  const blocks: string[] = [];
  for (const entry of parsed.entries) {
    const heading = `### ${escapeInlineMarkdown(entry.label)} — ${escapeInlineMarkdown(entry.filename)}`;
    blocks.push(heading);
    if (entry.description.trim().length > 0) {
      blocks.push(escapeInlineMarkdown(entry.description.trim()));
    }
    if (entry.supportsCriteria.length > 0) {
      const criteria = entry.supportsCriteria
        .map((c) => prettifyCriterion(c))
        .map((c) => escapeInlineMarkdown(c))
        .join(" · ");
      blocks.push(`- **Supports:** ${criteria}`);
    }
  }
  return blocks.join("\n\n");
}

function safeParseExhibitIndex(
  json: string,
): { entries: ReadonlyArray<{
    label: string;
    documentId: string;
    filename: string;
    description: string;
    supportsCriteria: string[];
  }> } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const result = ExhibitIndexSchema.safeParse(raw);
  if (!result.success) return null;
  return result.data;
}

/** Friendly fallback when the stored content can't be parsed. The raw
 *  content is preserved so the attorney can recover or escalate; the
 *  rendered output is markdown that flows through `MarkdownRenderer`
 *  cleanly (no fenced code blocks — those are stripped by the editor's
 *  StarterKit config and would render as plain text in the PDF). */
function formatRawFallback(raw: string, label: string): string {
  return [
    `> Could not format ${label} — raw output below. Try Regenerate to recover, or contact support if this persists.`,
    "",
    escapeInlineMarkdown(raw),
  ].join("\n\n");
}
