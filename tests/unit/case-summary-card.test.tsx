// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { CaseSummaryCard } from "@/components/case/CaseSummaryCard";

afterEach(cleanup);

const base = {
  visaType: "O-1A",
  recommenderCount: 3,
  documentCount: 11,
  usedBytes: 50_331_648, // ~48 MB
  outputsApproved: 5,
  outputsTotal: 6,
};

describe("CaseSummaryCard", () => {
  it("renders the always-present rows with formatted values", () => {
    render(<CaseSummaryCard {...base} />);
    expect(screen.getByText("Visa")).toBeInTheDocument();
    expect(screen.getByText("O-1A")).toBeInTheDocument();
    expect(screen.getByText("3 confirmed")).toBeInTheDocument();
    expect(screen.getByText("11 · 48.0 MB")).toBeInTheDocument();
    expect(screen.getByText("5 / 6 ready")).toBeInTheDocument();
  });

  it("appends the field to the visa when present", () => {
    render(<CaseSummaryCard {...base} field="Sciences" />);
    expect(screen.getByText(/O-1A · Sciences/)).toBeInTheDocument();
  });

  it("omits optional rows when their data is absent", () => {
    render(<CaseSummaryCard {...base} />);
    expect(screen.queryByText("Country of birth")).toBeNull();
    expect(screen.queryByText("Residence")).toBeNull();
    expect(screen.queryByText("Target filing")).toBeNull();
  });

  it("shows optional rows when provided", () => {
    render(
      <CaseSummaryCard
        {...base}
        nationality="Mexico"
        residence="Austin, United States"
        targetFilingDate="2026-05-02"
      />,
    );
    expect(screen.getByText("Mexico")).toBeInTheDocument();
    expect(screen.getByText("Austin, United States")).toBeInTheDocument();
    expect(screen.getByText("2026-05-02")).toBeInTheDocument();
  });

  it("shows 'None yet' when there are no outputs", () => {
    render(<CaseSummaryCard {...base} outputsApproved={0} outputsTotal={0} />);
    expect(screen.getByText("None yet")).toBeInTheDocument();
  });
});
