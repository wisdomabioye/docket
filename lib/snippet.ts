/**
 * Turns a bounded slice of an output's markdown `content` into a clean
 * one-line preview for the output grid cards (Stage 13 / #72). Strips the
 * markdown syntax so a card never shows raw `##`/`**`/link noise, collapses
 * whitespace, and truncates with an ellipsis.
 *
 * The caller ships only a bounded prefix of `content` (SQL `left(...)`) —
 * this never sees the full 50KB body. Structured/JSON output types should
 * not be passed here (their `content` is JSON, not prose).
 */
export function toSnippet(raw: string, maxLen = 140): string {
  const text = raw
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links / images → label
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // ATX heading markers
    .replace(/[*_~>#|]/g, "") // emphasis / blockquote / table / heading
    .replace(/\s+/g, " ") // collapse all whitespace
    .trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trimEnd()}…`;
}
