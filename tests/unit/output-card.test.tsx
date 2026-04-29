import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OutputCard } from "@/components/output/OutputCard";

/**
 * Stage 08 grid card. Pure presentational — every branch (approved
 * vs draft, recommendation-letter subtitle vs default, char-count
 * formatter) needs a render test so a refactor can't silently change
 * what the attorney sees in the grid.
 */

afterEach(() => cleanup());

const baseItem = {
  id: "00000000-0000-4000-8000-aaaa00000001",
  outputType: "personal_statement" as const,
  outputVersion: 3,
  subgroupKey: null as string | null,
  metadata: null as unknown,
  attorneyApproved: false,
  contentLength: 500,
  updatedAt: new Date("2026-04-29T12:00:00Z"),
};

describe("OutputCard — status pill", () => {
  it("shows 'Approved' badge when attorneyApproved=true", () => {
    render(
      <OutputCard
        caseId="case-1"
        item={{ ...baseItem, attorneyApproved: true }}
        sequence={1}
      />,
    );
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("shows 'Draft · v{n}' badge when attorneyApproved=false", () => {
    render(
      <OutputCard
        caseId="case-1"
        item={{ ...baseItem, attorneyApproved: false, outputVersion: 5 }}
        sequence={2}
      />,
    );
    expect(screen.getByText("Draft · v5")).toBeInTheDocument();
  });
});

describe("OutputCard — title + subtitle (recommendation letter)", () => {
  it("uses display-name title for non-recommendation types", () => {
    render(<OutputCard caseId="case-1" item={baseItem} sequence={1} />);
    // Personal Statement is the title (since no subgroup metadata).
    expect(
      screen.getByRole("heading", { level: 3, name: /personal statement/i }),
    ).toBeInTheDocument();
  });

  it("uses recommenderName from metadata for recommendation_letter_template", () => {
    render(
      <OutputCard
        caseId="case-1"
        item={{
          ...baseItem,
          outputType: "recommendation_letter_template",
          subgroupKey: "rec-1",
          metadata: { recommenderName: "Dr. Jane Doe" },
        }}
        sequence={3}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 3, name: /Dr\. Jane Doe/ }),
    ).toBeInTheDocument();
  });

  it("falls back to display-name when metadata is null for recommendation letter", () => {
    render(
      <OutputCard
        caseId="case-1"
        item={{
          ...baseItem,
          outputType: "recommendation_letter_template",
          subgroupKey: "rec-1",
          metadata: null,
        }}
        sequence={3}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 3, name: /recommendation letter/i }),
    ).toBeInTheDocument();
  });

  it("falls back to display-name when metadata is malformed", () => {
    render(
      <OutputCard
        caseId="case-1"
        item={{
          ...baseItem,
          outputType: "recommendation_letter_template",
          subgroupKey: "rec-1",
          metadata: { recommenderName: 12345 }, // wrong type
        }}
        sequence={3}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 3, name: /recommendation letter/i }),
    ).toBeInTheDocument();
  });
});

describe("OutputCard — sequence + meta", () => {
  it("zero-pads single-digit sequence to 2 chars", () => {
    render(<OutputCard caseId="case-1" item={baseItem} sequence={1} />);
    expect(
      screen.getByText(/^01 · Personal Statement$/),
    ).toBeInTheDocument();
  });

  it("formats char count under 1000 as 'N chars'", () => {
    render(
      <OutputCard
        caseId="case-1"
        item={{ ...baseItem, contentLength: 750 }}
        sequence={1}
      />,
    );
    expect(screen.getByText(/750 chars/)).toBeInTheDocument();
  });

  it("formats char count between 1000-9999 as 'N.N kc'", () => {
    render(
      <OutputCard
        caseId="case-1"
        item={{ ...baseItem, contentLength: 4500 }}
        sequence={1}
      />,
    );
    expect(screen.getByText(/4\.5 kc/)).toBeInTheDocument();
  });

  it("formats char count >=10k as 'N kc'", () => {
    render(
      <OutputCard
        caseId="case-1"
        item={{ ...baseItem, contentLength: 27_500 }}
        sequence={1}
      />,
    );
    expect(screen.getByText(/28 kc/)).toBeInTheDocument();
  });
});

describe("OutputCard — link target", () => {
  it("renders an anchor with href to the per-output detail route", () => {
    const { container } = render(
      <OutputCard caseId="case-9" item={baseItem} sequence={1} />,
    );
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe(
      "/case/case-9/outputs/00000000-0000-4000-8000-aaaa00000001",
    );
  });
});
