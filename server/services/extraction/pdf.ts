import "server-only";

/**
 * Extract plain text from a PDF buffer using `pdf-parse` v2's `PDFParse`
 * class. Lazy-imported because the module pulls in pdfjs-dist (large)
 * and we only need it on uploads.
 */
export async function extractPdf(bytes: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  const result = await parser.getText();
  // v2 returns `{ text: string, pages: PageTextResult[] }`.
  return result.text ?? "";
}
