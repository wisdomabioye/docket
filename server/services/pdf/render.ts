import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { storage } from "@/server/services/storage";

/**
 * PDF render + upload pipeline.
 *
 * `renderPdfToBuffer(element)` is the only place that calls
 * `@react-pdf/renderer`. Centralizing it keeps the SDK boundary tight
 * and makes mocking straightforward in tests (vi.mock the whole module).
 *
 * `uploadPdfAndSign({ buffer, key, expiresInSeconds })` writes via the
 * abstracted `storage` backend and returns a download URL. Stage 08
 * uses 10-minute signed URLs (spec locked decision); the per-call
 * `expiresInSeconds` override is exposed for future Stage 11 polish.
 */

const PDF_MIME_TYPE = "application/pdf";

/** Default download-URL lifetime. Spec Stage 08 locks 10 minutes. */
export const DEFAULT_PDF_URL_TTL_SECONDS = 600;

/** Storage-key conventions for Stage 08. Both the per-output and the
 *  package PDFs land under `cases/{caseId}/pdf/...` so the existing
 *  per-case storage scopes cover them. Timestamps disambiguate
 *  re-renders (callers regenerate the PDF on every download to reflect
 *  the latest content). */
export function perOutputPdfKey(args: {
  caseId: string;
  outputId: string;
  timestampMs: number;
}): string {
  return `cases/${args.caseId}/pdf/output-${args.outputId}-${args.timestampMs}.pdf`;
}

export function packagePdfKey(args: {
  caseId: string;
  timestampMs: number;
}): string {
  return `cases/${args.caseId}/pdf/package-${args.timestampMs}.pdf`;
}

/** Render a React-PDF document to a Buffer. Throws on render failure
 *  (which happens for, e.g., a Document with zero pages). Tests can
 *  `vi.mock` this whole module to avoid the SDK's heavy startup cost. */
export async function renderPdfToBuffer(
  element: ReactElement<DocumentProps>,
): Promise<Buffer> {
  return await renderToBuffer(element);
}

/** Upload + sign in a single call. The buffer is held in memory only
 *  for the duration of this call; we don't persist anywhere besides
 *  the storage backend. */
export async function uploadPdfAndSign(args: {
  buffer: Buffer;
  key: string;
  expiresInSeconds?: number;
}): Promise<string> {
  await storage.put(args.key, args.buffer, { mimeType: PDF_MIME_TYPE });
  return await storage.signedUrl(args.key, {
    expiresInSeconds: args.expiresInSeconds ?? DEFAULT_PDF_URL_TTL_SECONDS,
  });
}

/** End-to-end render + upload. The single call site `output.downloadPdf`
 *  / `output.downloadPackage` use; tests mock at the `renderPdfToBuffer`
 *  level to avoid the renderer cost AND the storage write. */
export async function renderAndStorePdf(args: {
  element: ReactElement<DocumentProps>;
  key: string;
  expiresInSeconds?: number;
}): Promise<{ url: string; key: string; bytes: number }> {
  const buffer = await renderPdfToBuffer(args.element);
  const url = await uploadPdfAndSign({
    buffer,
    key: args.key,
    ...(args.expiresInSeconds !== undefined
      ? { expiresInSeconds: args.expiresInSeconds }
      : {}),
  });
  return { url, key: args.key, bytes: buffer.byteLength };
}
