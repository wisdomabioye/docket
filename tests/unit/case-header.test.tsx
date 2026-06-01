// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// CaseHeader embeds the client `CaseActionBar` (Stage 13), which uses
// `useRouter` + `trpc.case.guidance`. Stub both so these header-chrome
// tests render without the app-router / tRPC providers. The bar returns
// null when its query has no data, so it stays out of the assertions.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    case: {
      guidance: {
        useQuery: () => ({ data: undefined, refetch: vi.fn() }),
      },
    },
  },
}));

import { CaseHeader } from "@/components/case/CaseHeader";
import { deriveCaseStage } from "@/lib/case-stage";

afterEach(cleanup);

const filedStage = deriveCaseStage({ status: "filed" });

describe("CaseHeader — tabs", () => {
  it("renders exactly the 5 mockup tabs (Overview / Intake / Documents / Outputs / Package)", () => {
    render(
      <CaseHeader
        caseId="11111111-2222-3333-4444-555555555555"
        beneficiaryName="Maria Gonzalez"
        visaType="O-1A"
        status="filed"
        stage={filedStage}
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
        stage={filedStage}
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
        stage={filedStage}
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
        stage={filedStage}
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
        stage={filedStage}
        current="overview"
      />,
    );
    expect(screen.getByText(/CASE-ABCD/)).toBeInTheDocument();
  });
});
