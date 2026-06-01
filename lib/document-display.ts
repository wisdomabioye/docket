import type { BadgeVariant } from "@/components/ui";

/**
 * Pure display helpers for the documents list (Stage 13 / #72). Kept out
 * of the heavy `DocumentsPanel` client component so they're unit-testable.
 * `import type` keeps this free of any runtime coupling to the UI layer.
 */

/** Maps a `case_documents.extraction_status` to a pill. Enum values
 *  (from `extractionStatusEnum`): pending | processing | completed |
 *  failed. Plus the client-only `"uploading"` pseudo-status the documents
 *  panel uses for the optimistic in-flight row before the upload resolves. */
export function extractionBadge(status: string): {
  variant: BadgeVariant;
  label: string;
} {
  switch (status) {
    case "completed":
      return { variant: "success", label: "Extracted" };
    case "failed":
      return { variant: "error", label: "OCR failed" };
    case "processing":
      return { variant: "info", label: "Processing" };
    case "pending":
      return { variant: "info", label: "Queued" };
    case "uploading":
      return { variant: "info", label: "Uploading…" };
    default:
      return { variant: "neutral", label: status };
  }
}

/** Short uppercase file-type label from a filename ("cv.pdf" → "PDF").
 *  Falls back to "FILE" when there's no extension. Capped at 4 chars so
 *  the icon box stays square-ish. */
export function fileExtLabel(filename: string): string {
  const dot = filename.lastIndexOf(".");
  // `dot <= 0` also rejects dotfiles (".gitignore" — the dot is the name,
  // not an extension separator), alongside no-dot and trailing-dot.
  if (dot <= 0 || dot === filename.length - 1) return "FILE";
  return filename.slice(dot + 1).toUpperCase().slice(0, 4);
}
