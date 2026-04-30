// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CriteriaCoverageCard } from "@/components/case/CriteriaCoverageCard";

afterEach(() => cleanup());

/**
 * Pure render component — covers the supported / unsupported branch +
 * the strength labels. The data shape comes from `computeCriteriaCoverage`;
 * the integration test (`case-coverage.test.ts`) covers the SQL.
 */
describe("CriteriaCoverageCard", () => {
  it("renders an EmptyState for unsupported visa types (EB-1A in Phase 1)", () => {
    render(
      <CriteriaCoverageCard
        visaType="EB-1A"
        visaSupported={false}
        rows={[]}
        metCount={0}
        minRequired={0}
      />,
    );
    expect(
      screen.getByText(/Coverage analysis for EB-1A ships/i),
    ).toBeInTheDocument();
  });

  it("shows '<met> met' + 'needs ≥<min> to qualify' meta line", () => {
    render(
      <CriteriaCoverageCard
        visaType="O-1A"
        visaSupported={true}
        rows={[
          { code: 1, name: "Prizes", exhibitCount: 2, strength: "moderate" },
          { code: 2, name: "Membership", exhibitCount: 0, strength: "none" },
        ]}
        metCount={1}
        minRequired={3}
      />,
    );
    expect(screen.getByText(/O-1A · 2 criteria · 1 met/i)).toBeInTheDocument();
    expect(screen.getByText(/needs ≥3 to qualify/i)).toBeInTheDocument();
  });

  it("renders the four strength labels per row", () => {
    render(
      <CriteriaCoverageCard
        visaType="O-1A"
        visaSupported={true}
        rows={[
          { code: 1, name: "Strong row", exhibitCount: 3, strength: "strong" },
          { code: 2, name: "Moderate row", exhibitCount: 2, strength: "moderate" },
          { code: 3, name: "Weak row", exhibitCount: 1, strength: "weak" },
          { code: 4, name: "None row", exhibitCount: 0, strength: "none" },
        ]}
        metCount={3}
        minRequired={3}
      />,
    );
    expect(screen.getByText("Strong")).toBeInTheDocument();
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    expect(screen.getByText("Weak")).toBeInTheDocument();
    expect(screen.getByText("Not met")).toBeInTheDocument();
  });

  it("singular 'exhibit' label for count=1, plural otherwise", () => {
    render(
      <CriteriaCoverageCard
        visaType="O-1A"
        visaSupported={true}
        rows={[
          { code: 1, name: "Solo", exhibitCount: 1, strength: "weak" },
          { code: 2, name: "Pair", exhibitCount: 2, strength: "moderate" },
        ]}
        metCount={2}
        minRequired={3}
      />,
    );
    expect(screen.getByText("1 exhibit")).toBeInTheDocument();
    expect(screen.getByText("2 exhibits")).toBeInTheDocument();
  });
});
