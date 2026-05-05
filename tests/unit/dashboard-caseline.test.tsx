// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { Caseline } from "@/components/dashboard/Caseline";
import { CaselineList } from "@/components/dashboard/CaselineList";

afterEach(cleanup);

const baseRow = {
  caseId: "11111111-2222-3333-4444-555555555555",
  beneficiaryName: "Maria Gonzalez",
  visaType: "O-1A",
  stageLabel: "Drafts ready",
  stagePercent: 65,
  updatedLabel: "Apr 30",
};

describe("Caseline row", () => {
  it("renders beneficiary, visa, stage label, updated", () => {
    render(<Caseline {...baseRow} />);
    expect(screen.getByText("Maria Gonzalez")).toBeInTheDocument();
    expect(screen.getByText("O-1A")).toBeInTheDocument();
    expect(screen.getByText("Drafts ready")).toBeInTheDocument();
    // The updated label renders twice in the DOM — once in the
    // mobile-only top row, once in the md+ right column. CSS hides
    // one per breakpoint; jsdom sees both.
    expect(screen.getAllByText("Apr 30").length).toBeGreaterThan(0);
  });

  it("links the row to the case detail page", () => {
    render(<Caseline {...baseRow} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `/case/${baseRow.caseId}`);
  });

  it("renders nextAction + nextDue when supplied", () => {
    render(
      <Caseline
        {...baseRow}
        nextAction="Review drafts"
        nextDue="DUE TMW"
      />,
    );
    expect(screen.getByText("Review drafts")).toBeInTheDocument();
    expect(screen.getByText("DUE TMW")).toBeInTheDocument();
  });

  it("falls back to em-dash when nextAction is omitted", () => {
    render(<Caseline {...baseRow} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders 'Unnamed' avatar fallback when name has no word chars", () => {
    render(<Caseline {...baseRow} beneficiaryName="" />);
    expect(screen.getByText("·")).toBeInTheDocument();
  });

  it("encodes a stable short case-id derived from the UUID prefix", () => {
    render(<Caseline {...baseRow} />);
    expect(screen.getByText("CASE-1111")).toBeInTheDocument();
  });
});

describe("CaselineList", () => {
  it("renders header row + data rows", () => {
    render(<CaselineList items={[baseRow, { ...baseRow, caseId: "x" }]} />);
    expect(screen.getByText("Beneficiary")).toBeInTheDocument();
    expect(screen.getByText("Visa")).toBeInTheDocument();
    expect(screen.getByText("Stage")).toBeInTheDocument();
    expect(screen.getByText("Next action")).toBeInTheDocument();
    expect(screen.getByText("Updated")).toBeInTheDocument();
  });

  it("renders the empty state when items is empty", () => {
    render(
      <CaselineList items={[]} emptyState={<p>No cases yet.</p>} />,
    );
    expect(screen.getByText(/no cases yet/i)).toBeInTheDocument();
  });
});
