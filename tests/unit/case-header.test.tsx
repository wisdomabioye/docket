// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { CaseHeader } from "@/components/case/CaseHeader";

afterEach(cleanup);

describe("CaseHeader — tabs", () => {
  it("renders exactly the 5 mockup tabs (Overview / Intake / Documents / Outputs / Package)", () => {
    render(
      <CaseHeader
        caseId="11111111-2222-3333-4444-555555555555"
        beneficiaryName="Maria Gonzalez"
        visaType="O-1A"
        status="filed"
        current="overview"
      />,
    );
    const tabBar = screen.getByRole("navigation");
    const tabs = Array.from(tabBar.querySelectorAll("a")).map(
      (a) => a.textContent?.trim() ?? "",
    );
    expect(tabs).toEqual([
      "Overview",
      "Intake",
      "Documents",
      "Outputs",
      "Package",
    ]);
  });

  it("does NOT render a Build tab (mockup reaches Build via the header CTA)", () => {
    render(
      <CaseHeader
        caseId="11111111-2222-3333-4444-555555555555"
        beneficiaryName="Maria Gonzalez"
        visaType="O-1A"
        status="filed"
        current="overview"
      />,
    );
    expect(screen.queryByRole("link", { name: /build/i })).toBeNull();
  });

  it("highlights the current tab via the active style + the leaf indicator", () => {
    render(
      <CaseHeader
        caseId="11111111-2222-3333-4444-555555555555"
        beneficiaryName="Maria Gonzalez"
        visaType="O-1A"
        status="filed"
        current="documents"
      />,
    );
    const docsLink = screen.getByRole("link", { name: /documents/i });
    // Active style sets fontWeight 500 inline; sibling underline span
    // appears only when active.
    expect(docsLink).toHaveStyle({ fontWeight: "500" });
  });

  it("renders the actions slot (Package / Build / Review-drafts CTAs)", () => {
    render(
      <CaseHeader
        caseId="11111111-2222-3333-4444-555555555555"
        beneficiaryName="Maria Gonzalez"
        visaType="O-1A"
        status="ready_to_build"
        current="overview"
        actions={
          <button type="button" data-testid="build-cta">
            Build →
          </button>
        }
      />,
    );
    expect(screen.getByTestId("build-cta")).toBeInTheDocument();
  });

  it("uses the shared `shortCaseId` helper in the eyebrow", () => {
    render(
      <CaseHeader
        caseId="abcdef00-0000-0000-0000-000000000000"
        beneficiaryName="Maria Gonzalez"
        visaType="O-1A"
        status="filed"
        current="overview"
      />,
    );
    expect(screen.getByText(/CASE-ABCD/)).toBeInTheDocument();
  });
});
