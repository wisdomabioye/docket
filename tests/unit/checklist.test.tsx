// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Checklist } from "@/components/ui/Checklist";

afterEach(() => cleanup());

/**
 * `Checklist` is the shared primitive behind the Documents required-doc
 * rail and (eventually) other onboarding-style lists. Tests pin the
 * three status glyphs + the optional tag pill — drift here would
 * silently change every checklist surface.
 */
describe("Checklist", () => {
  it("renders one row per item with status data attribute for styling hooks", () => {
    const { container } = render(
      <Checklist
        items={[
          { key: "a", label: "First item", status: "done" },
          { key: "b", label: "Second item", status: "open" },
          { key: "c", label: "Third item", status: "unknown" },
        ]}
      />,
    );
    const rows = container.querySelectorAll("li");
    expect(rows).toHaveLength(3);
    expect(rows[0]?.dataset.status).toBe("done");
    expect(rows[1]?.dataset.status).toBe("open");
    expect(rows[2]?.dataset.status).toBe("unknown");
  });

  it("uses an a11y label per glyph so the row state is screen-reader-readable", () => {
    render(
      <Checklist
        items={[
          { key: "a", label: "Done one", status: "done" },
          { key: "b", label: "Open one", status: "open" },
          { key: "c", label: "Unknown one", status: "unknown" },
        ]}
      />,
    );
    expect(screen.getByLabelText("Done")).toBeInTheDocument();
    expect(screen.getByLabelText("Open")).toBeInTheDocument();
    expect(screen.getByLabelText("Manual verification needed")).toBeInTheDocument();
  });

  it("renders an optional tag pill on rows that supply one", () => {
    render(
      <Checklist
        items={[
          { key: "a", label: "With info", status: "open", tag: "CRIT 5" },
          {
            key: "b",
            label: "With warning",
            status: "open",
            tag: "2 OF 3",
            tagTone: "warning",
          },
          { key: "c", label: "Plain", status: "done" },
        ]}
      />,
    );
    expect(screen.getByText("CRIT 5")).toBeInTheDocument();
    expect(screen.getByText("2 OF 3")).toBeInTheDocument();
    // No phantom tag for the plain row.
    expect(screen.queryByText(/^TAG/)).not.toBeInTheDocument();
  });

  it("renders nothing when the items list is empty (caller controls emptiness)", () => {
    const { container } = render(<Checklist items={[]} />);
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});
