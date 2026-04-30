// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PreflightCard } from "@/components/case/PreflightCard";

afterEach(() => cleanup());

/**
 * `PreflightCard` is pure render — gates come from `case.preflight`.
 * Tests pin the meta line copy + the dot a11y labels (the only signal
 * that distinguishes pass from fail without reading the detail copy).
 */
describe("PreflightCard", () => {
  it("renders 'All passed' meta + four 'Passed' dots when allOk=true", () => {
    render(
      <PreflightCard
        allOk={true}
        gates={[
          { id: "a", label: "A", ok: true, detail: "ok" },
          { id: "b", label: "B", ok: true, detail: "ok" },
          { id: "c", label: "C", ok: true, detail: "ok" },
          { id: "d", label: "D", ok: true, detail: "ok" },
        ]}
      />,
    );
    expect(screen.getByText("All passed")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Passed")).toHaveLength(4);
    expect(screen.queryAllByLabelText("Needs attention")).toHaveLength(0);
  });

  it("renders 'X of Y passed' + per-gate 'Needs attention' dots when failing", () => {
    render(
      <PreflightCard
        allOk={false}
        gates={[
          { id: "a", label: "Outputs", ok: true, detail: "1 ready" },
          { id: "b", label: "Criteria", ok: false, detail: "2 of 3" },
          { id: "c", label: "Letters", ok: false, detail: "none" },
          { id: "d", label: "Bar", ok: true, detail: "active" },
        ]}
      />,
    );
    expect(screen.getByText(/2 of 4 passed/)).toBeInTheDocument();
    expect(screen.getAllByLabelText("Passed")).toHaveLength(2);
    expect(screen.getAllByLabelText("Needs attention")).toHaveLength(2);
  });

  it("renders the gate label + detail copy for each row", () => {
    render(
      <PreflightCard
        allOk={false}
        gates={[
          {
            id: "a",
            label: "Outputs approved",
            ok: false,
            detail: "Approve at least one output.",
          },
        ]}
      />,
    );
    expect(screen.getByText("Outputs approved")).toBeInTheDocument();
    expect(
      screen.getByText("Approve at least one output."),
    ).toBeInTheDocument();
  });
});
