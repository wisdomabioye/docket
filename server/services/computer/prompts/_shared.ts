import "server-only";

/**
 * Helpers shared across multiple prompt builders. Keep this file tight
 * — one helper per concern, no domain logic. Prompt-specific concerns
 * stay in the per-output builder file.
 */

/**
 * First N chars of `s` plus an ellipsis. Used to keep document
 * excerpts in the prompt context brief; the full extracted text
 * remains in the `case_documents` row for attorney reference.
 *
 * Returns `"(no extracted text)"` for empty input so the prompt always
 * has SOMETHING in the document slot — saves the model from a confusing
 * empty section.
 */
export function snippet(s: string, n: number): string {
  if (!s) return "(no extracted text)";
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
