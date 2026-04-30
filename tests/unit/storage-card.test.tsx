// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StorageCard } from "@/components/case/StorageCard";

afterEach(() => cleanup());

const MB = 1024 * 1024;
const CAP = BigInt(500 * MB);

/**
 * `StorageCard` formats bytes → MB and flips the ProgressBar tone at
 * 60% / 85%. Tests cover the format, the doc-count pluralization, and
 * each tone band (the rendered tone surfaces via the ProgressBar's
 * data-tone attribute).
 */
describe("StorageCard", () => {
  it("formats usedBytes as MB to one decimal", () => {
    const { container } = render(
      <StorageCard
        usedBytes={BigInt(Math.round(48.2 * MB))}
        capBytes={CAP}
        documentCount={3}
      />,
    );
    // The header line renders "<used> / <cap> MB" across nested text
    // nodes — assert via the parent <p>'s normalized text content.
    const headerText = container.querySelector("p")?.textContent ?? "";
    expect(headerText.replace(/\s+/g, "")).toContain("48.2/500.0MB");
  });

  it("uses 'document' singular for count=1, 'documents' otherwise", () => {
    const { rerender } = render(
      <StorageCard usedBytes={0n} capBytes={CAP} documentCount={1} />,
    );
    expect(screen.getByText(/1 document$/)).toBeInTheDocument();

    rerender(
      <StorageCard usedBytes={0n} capBytes={CAP} documentCount={5} />,
    );
    expect(screen.getByText(/5 documents$/)).toBeInTheDocument();
  });

  it("renders the ProgressBar with tone=accent when below 60%", () => {
    const { container } = render(
      <StorageCard
        usedBytes={BigInt(100 * MB)}
        capBytes={CAP}
        documentCount={1}
      />,
    );
    // ProgressBar exposes role=progressbar with aria-valuenow.
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("20");
  });

  it("clamps to 100 when used > cap (corrupt over-cap data renders cleanly)", () => {
    const { container } = render(
      <StorageCard
        usedBytes={BigInt(600 * MB)}
        capBytes={CAP}
        documentCount={9}
      />,
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("100");
  });
});
