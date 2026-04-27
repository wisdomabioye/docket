import "server-only";

/**
 * Extract plain text from a DOCX buffer using `mammoth`.
 *
 * `mammoth.extractRawText` returns markdown-ish text without styling.
 * Sufficient for passing to the Computer; the attorney never sees this
 * raw text (they see the original document via signed URL).
 */
export async function extractDocx(bytes: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: bytes });
  return result.value;
}
