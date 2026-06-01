// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { CaseNextAction } from "@/components/case/CaseNextAction";
import { deriveCaseStage } from "@/lib/case-stage";
import type { CaseStatus } from "@/lib/case-status";
import type { CaseGuidance } from "@/server/services/cases/guidance";

afterEach(cleanup);

/** Build a CaseGuidance fixture from a status + overrides. The stage is
 *  derived from the real mapper so labels/sub stay in sync. */
function mk(
  status: CaseStatus,
  over: Partial<Omit<CaseGuidance, "stage" | "audience">> = {},
): CaseGuidance {
  const stage = deriveCaseStage({ status });
  return {
    stage,
    primary: over.primary ?? null,
    blockers: over.blockers ?? [],
    progress: over.progress ?? {
      pct: stage.progressPct,
      indeterminate: false,
    },
    audience: "attorney",
  };
}

describe("CaseNextAction — card variant", () => {
  it("actionable: renders an enabled primary CTA, no blockers", () => {
    render(
      <CaseNextAction
        variant="card"
        guidance={mk("ready_to_build", {
          primary: { label: "Build case", href: "/case/x/build", enabled: true },
        })}
      />,
    );
    const cta = screen.getByRole("link", { name: /Build case/i });
    expect(cta).toHaveAttribute("href", "/case/x/build");
    expect(cta).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText(/Fix →/)).toBeNull();
  });

  it("blocked-fix: primary is the fix action + blocker rows with Fix links", () => {
    render(
      <CaseNextAction
        variant="card"
        guidance={mk("ready_to_build", {
          primary: {
            label: "Upload a document",
            href: "/case/x/documents",
            enabled: true,
          },
          blockers: [
            {
              label: "Upload at least one document with extractable text.",
              resolveHref: "/case/x/documents",
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByText(/Upload at least one document/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Fix →/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Upload a document →/i }),
    ).toHaveAttribute("href", "/case/x/documents");
  });

  it("wait-only: primary is disabled and wait blocker has no Fix link", () => {
    render(
      <CaseNextAction
        variant="card"
        guidance={mk("ready_to_build", {
          primary: { label: "Build case", href: "/case/x/build", enabled: false },
          blockers: [
            { label: "1 document is still being processed.", resolveHref: null },
          ],
        })}
      />,
    );
    // Disabled primary renders as a non-navigable element (NOT a link) so
    // it's unreachable by mouse and keyboard.
    expect(screen.queryByRole("link", { name: /Build case/i })).toBeNull();
    const cta = screen.getByRole("button", { name: /Build case/i });
    expect(cta).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText(/Fix →/)).toBeNull();
  });

  it("in-progress: no primary CTA, shows stage copy", () => {
    render(
      <CaseNextAction
        variant="card"
        guidance={mk("building", {
          progress: { pct: 55, indeterminate: true },
        })}
      />,
    );
    expect(screen.getByText("Building drafts")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("CaseNextAction — bar variant", () => {
  it("actionable: renders an enabled next link", () => {
    render(
      <CaseNextAction
        variant="bar"
        guidance={mk("draft_ready", {
          primary: {
            label: "Review drafts",
            href: "/case/x/outputs",
            enabled: true,
          },
        })}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Review drafts →/i }),
    ).toHaveAttribute("href", "/case/x/outputs");
  });

  it("wait-only: shows the disabled label + 'waiting on'", () => {
    render(
      <CaseNextAction
        variant="bar"
        guidance={mk("ready_to_build", {
          primary: { label: "Build case", href: "/case/x/build", enabled: false },
          blockers: [
            { label: "1 document is still being processed.", resolveHref: null },
          ],
        })}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/waiting on/i)).toBeInTheDocument();
  });

  it("in-progress: shows the 'In progress' marker, no link", () => {
    render(
      <CaseNextAction
        variant="bar"
        guidance={mk("extracting", {
          progress: { pct: 32, indeterminate: true },
        })}
      />,
    );
    expect(screen.getByText(/In progress/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("wait-only: 'waiting on' uses the FIRST wait-only blocker", () => {
    render(
      <CaseNextAction
        variant="bar"
        guidance={mk("ready_to_build", {
          primary: { label: "Build case", href: "/case/x/build", enabled: false },
          blockers: [
            { label: "first wait blocker", resolveHref: null },
            { label: "second wait blocker", resolveHref: null },
          ],
        })}
      />,
    );
    expect(screen.getByText(/waiting on first wait blocker/i)).toBeInTheDocument();
    expect(screen.queryByText(/second wait blocker/i)).toBeNull();
  });

  it("disabled primary with NO wait-only blocker shows no 'waiting on'", () => {
    render(
      <CaseNextAction
        variant="bar"
        guidance={mk("ready_to_build", {
          primary: { label: "Build case", href: "/case/x/build", enabled: false },
          blockers: [{ label: "an actionable one", resolveHref: "/case/x/documents" }],
        })}
      />,
    );
    expect(screen.queryByText(/waiting on/i)).toBeNull();
  });
});
