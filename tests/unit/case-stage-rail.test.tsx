// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { CaseStageRail } from "@/components/case/CaseStageRail";
import { deriveCaseStage } from "@/lib/case-stage";

afterEach(cleanup);

describe("CaseStageRail", () => {
  it("renders all 5 pipeline steps in order", () => {
    render(<CaseStageRail stage={deriveCaseStage({ status: "intake" })} />);
    const labels = screen.getAllByText(
      /^(Intake|Documents|Drafting|Review|Filed)$/,
    );
    expect(labels.map((l) => l.textContent)).toEqual([
      "Intake",
      "Documents",
      "Drafting",
      "Review",
      "Filed",
    ]);
  });

  it("flags the current step with aria-current", () => {
    render(<CaseStageRail stage={deriveCaseStage({ status: "draft_ready" })} />);
    const current = screen.getByLabelText("Case progress").querySelector(
      "[aria-current='step']",
    );
    expect(current?.textContent).toContain("Drafting");
  });

  it("shows the next-action CTA when defined", () => {
    render(<CaseStageRail stage={deriveCaseStage({ status: "draft_ready" })} />);
    expect(screen.getByText(/Next: Review drafts/i)).toBeInTheDocument();
  });

  it("hides the next-action CTA on no-action states (filed)", () => {
    render(<CaseStageRail stage={deriveCaseStage({ status: "filed" })} />);
    expect(screen.queryByText(/^Next:/i)).toBeNull();
  });

  it("renders the stage sub copy", () => {
    render(
      <CaseStageRail
        stage={deriveCaseStage({
          status: "in_review",
          approvals: { approved: 2, total: 5 },
        })}
      />,
    );
    expect(screen.getByText(/2 of 5 outputs approved/i)).toBeInTheDocument();
  });
});
