import "server-only";
import { extractPdf } from "./pdf";
import { extractDocx } from "./docx";

/**
 * Extract plain text from an uploaded file.
 *
 * Returns `{ text }` on success, `{ error }` when the MIME type isn't
 * supported or the extractor itself throws. Caller decides how to record
 * the failure (`extractionStatus: "failed"` + `extractionError`).
 *
 * Phase 1 supports: PDF, DOCX. Image OCR (tesseract) is Stage 06.5;
 * other MIME types return `{ error: "unsupported" }`.
 */
export async function extract(args: {
  bytes: Buffer;
  mimeType: string;
}): Promise<{ text: string } | { error: string }> {
  try {
    if (args.mimeType === "application/pdf") {
      return { text: await extractPdf(args.bytes) };
    }
    if (
      args.mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return { text: await extractDocx(args.bytes) };
    }
    return { error: `unsupported MIME type: ${args.mimeType}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `extractor threw: ${msg}` };
  }
}
