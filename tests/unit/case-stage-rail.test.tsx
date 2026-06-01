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

  // The next-action CTA moved out of the rail into `CaseActionBar` /
  // `CaseNextAction` (Stage 13) — the rail now shows progress + sub only.
  // CTA behavior is covered in `case-next-action.test.tsx`.

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
