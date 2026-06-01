// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Capture the options passed to useQuery so we can exercise the
// function-form refetchInterval decision directly, and control the data
// the bar renders. `refreshMock` lets us assert the in-progress→done
// edge fires router.refresh exactly once.
const refreshMock = vi.hoisted(() => vi.fn());
const refetchMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const guidanceState = vi.hoisted(
  () => ({ data: undefined as unknown }),
);
const capturedOptions = vi.hoisted(
  () => ({ current: undefined as unknown }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    case: {
      guidance: {
        useQuery: (_input: unknown, options: unknown) => {
          capturedOptions.current = options;
          return { data: guidanceState.data, refetch: refetchMock };
        },
      },
    },
  },
}));

import { CaseActionBar } from "@/components/case/CaseActionBar";
import type { CaseGuidance } from "@/server/services/cases/guidance";

function guidance(indeterminate: boolean): CaseGuidance {
  return {
    stage: {
      pipelineKey: "drafting",
      label: indeterminate ? "Building drafts" : "Drafts ready",
      sub: "x",
      nextAction: indeterminate ? undefined : "Review drafts",
      progressPct: 55,
    },
    primary: indeterminate
      ? null
      : { label: "Review drafts", href: "/case/x/outputs", enabled: true },
    blockers: [],
    progress: { pct: 55, indeterminate },
    audience: "attorney",
  };
}

afterEach(() => {
  cleanup();
  refreshMock.mockClear();
  guidanceState.data = undefined;
  capturedOptions.current = undefined;
});

type RefetchFn = (q: {
  state: { data: CaseGuidance | undefined };
}) => number | false;

describe("CaseActionBar", () => {
  it("renders nothing until the query resolves", () => {
    guidanceState.data = undefined;
    const { container } = render(
      <CaseActionBar caseId="x" initialStatus="building" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the bar once guidance is available", () => {
    guidanceState.data = guidance(false);
    render(<CaseActionBar caseId="x" initialStatus="draft_ready" />);
    expect(
      screen.getByRole("link", { name: /Review drafts →/i }),
    ).toBeInTheDocument();
  });

  it("polls while indeterminate and stops when work finishes", () => {
    guidanceState.data = guidance(true);
    render(<CaseActionBar caseId="x" initialStatus="building" />);
    const refetchInterval = (capturedOptions.current as { refetchInterval: RefetchFn })
      .refetchInterval;
    // Live indeterminate → poll.
    expect(refetchInterval({ state: { data: guidance(true) } })).toBe(5000);
    // Finished → stop.
    expect(refetchInterval({ state: { data: guidance(false) } })).toBe(false);
  });

  it("seeds polling from initialStatus before data arrives", () => {
    guidanceState.data = undefined;
    render(<CaseActionBar caseId="x" initialStatus="building" />);
    const refetchInterval = (capturedOptions.current as { refetchInterval: RefetchFn })
      .refetchInterval;
    // No data yet, but seed says in-progress → poll.
    expect(refetchInterval({ state: { data: undefined } })).toBe(5000);
  });

  it("does NOT poll when seeded with a settled status and no data", () => {
    guidanceState.data = undefined;
    render(<CaseActionBar caseId="x" initialStatus="draft_ready" />);
    const refetchInterval = (capturedOptions.current as { refetchInterval: RefetchFn })
      .refetchInterval;
    expect(refetchInterval({ state: { data: undefined } })).toBe(false);
  });

  it("refreshes the page once when the pipeline finishes", () => {
    guidanceState.data = guidance(true);
    const view = render(<CaseActionBar caseId="x" initialStatus="building" />);
    expect(refreshMock).not.toHaveBeenCalled();
    // Work finishes → re-render with indeterminate=false.
    guidanceState.data = guidance(false);
    view.rerender(<CaseActionBar caseId="x" initialStatus="building" />);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
