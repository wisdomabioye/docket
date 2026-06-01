import { describe, expect, it } from "vitest";
import { extractionBadge, fileExtLabel } from "@/lib/document-display";

describe("extractionBadge", () => {
  it("maps each extraction_status enum value to a pill", () => {
    expect(extractionBadge("completed")).toEqual({
      variant: "success",
      label: "Extracted",
    });
    expect(extractionBadge("failed")).toEqual({
      variant: "error",
      label: "OCR failed",
    });
    expect(extractionBadge("processing")).toEqual({
      variant: "info",
      label: "Processing",
    });
    expect(extractionBadge("pending")).toEqual({
      variant: "info",
      label: "Queued",
    });
  });

  it("maps the client-only 'uploading' pseudo-status", () => {
    expect(extractionBadge("uploading")).toEqual({
      variant: "info",
      label: "Uploading…",
    });
  });

  it("falls back to neutral + raw label for an unknown status", () => {
    expect(extractionBadge("weird")).toEqual({
      variant: "neutral",
      label: "weird",
    });
  });
});

describe("fileExtLabel", () => {
  it("returns the uppercased extension", () => {
    expect(fileExtLabel("cv.pdf")).toBe("PDF");
    expect(fileExtLabel("Letter.DOCX")).toBe("DOCX");
    expect(fileExtLabel("a.b.png")).toBe("PNG");
  });

  it("caps long extensions at 4 chars", () => {
    expect(fileExtLabel("archive.tarball")).toBe("TARB");
  });

  it("falls back to FILE with no/empty extension", () => {
    expect(fileExtLabel("README")).toBe("FILE");
    expect(fileExtLabel("trailingdot.")).toBe("FILE");
  });

  it("treats a leading-dot file as having no extension", () => {
    expect(fileExtLabel(".gitignore")).toBe("FILE");
    expect(fileExtLabel(".env")).toBe("FILE");
  });
});
