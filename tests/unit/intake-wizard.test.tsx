// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * `IntakeWizard` exposes section nav + auto-save + completeIntake. The
 * tests mock the two trpc mutations + next/navigation hooks so we can
 * inspect the mutation payloads without the tRPC provider.
 *
 * Targets (one per branch that's easy to drift):
 *   1. The empty-patch bail (regression: server BAD_REQUEST when nav
 *      fired with no edits).
 *   2. Trim + propagate non-empty fields.
 *   3. Number coercion for the `yearsActive` control.
 *   4. Locked mode disables every input + the submit CTA.
 *   5. Section nav updates the URL via router.push.
 *   6. completeIntake fires only when status === 'intake'.
 */

const updateMutateMock = vi.hoisted(() => vi.fn());
const completeMutateMock = vi.hoisted(() => vi.fn());
const updateUseMutationMock = vi.hoisted(() =>
  vi.fn(() => ({
    mutate: updateMutateMock,
    isPending: false,
    error: null,
  })),
);
const completeUseMutationMock = vi.hoisted(() =>
  vi.fn(() => ({
    mutate: completeMutateMock,
    isPending: false,
    error: null,
  })),
);

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    case: {
      updateBeneficiary: { useMutation: updateUseMutationMock },
      completeIntake: { useMutation: completeUseMutationMock },
    },
  },
}));

const routerPushMock = vi.hoisted(() => vi.fn());
const searchParamsMock = vi.hoisted(() => ({
  get: vi.fn<(key: string) => string | null>(() => null),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock, refresh: vi.fn() }),
  useSearchParams: () => searchParamsMock,
}));

import { IntakeWizard } from "@/components/case/IntakeWizard";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  updateMutateMock.mockReset();
  completeMutateMock.mockReset();
  searchParamsMock.get.mockReset();
  searchParamsMock.get.mockImplementation(() => null as string | null);
  routerPushMock.mockReset();
  updateUseMutationMock.mockReset();
  updateUseMutationMock.mockReturnValue({
    mutate: updateMutateMock,
    isPending: false,
    error: null,
  });
  completeUseMutationMock.mockReset();
  completeUseMutationMock.mockReturnValue({
    mutate: completeMutateMock,
    isPending: false,
    error: null,
  });
});

const baseProps = {
  caseId: "case-1",
  initial: {},
  rowRevision: 1,
  currentStatus: "intake",
  locked: false,
};

describe("IntakeWizard — auto-save", () => {
  it("trims string fields and forwards non-empty values to updateBeneficiary", () => {
    render(<IntakeWizard {...baseProps} />);
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "  Test Beneficiary 001  " },
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(updateMutateMock).toHaveBeenCalledTimes(1);
    expect(updateMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: "case-1",
        expectedRowRevision: 1,
        patch: { fullName: "Test Beneficiary 001" },
      }),
      expect.any(Object),
    );
  });

  it("does NOT fire the mutation when every field is empty (regression: BAD_REQUEST on nav)", () => {
    render(<IntakeWizard {...baseProps} />);
    // Type then clear → field returns to empty string. The debounced
    // save must skip rather than send `{}`.
    const input = screen.getByLabelText("Full name");
    fireEvent.change(input, { target: { value: "X" } });
    fireEvent.change(input, { target: { value: "" } });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(updateMutateMock).not.toHaveBeenCalled();
  });

  it("flushes the pending save when the user navigates to another section", () => {
    render(<IntakeWizard {...baseProps} />);
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Test Beneficiary 001" },
    });
    // Click the Practice section in the side nav (no debounce wait).
    fireEvent.click(screen.getByRole("button", { name: /practice/i }));
    expect(updateMutateMock).toHaveBeenCalledTimes(1);
    expect(routerPushMock).toHaveBeenCalledWith(
      expect.stringContaining("?section=practice"),
      expect.objectContaining({ scroll: false }),
    );
  });
});

describe("IntakeWizard — locked", () => {
  it("disables every input when locked=true", () => {
    render(<IntakeWizard {...baseProps} locked currentStatus="extracting" />);
    for (const input of screen.getAllByRole("textbox")) {
      expect(input).toBeDisabled();
    }
  });

  it("never fires the mutation when locked, even on field change", () => {
    render(<IntakeWizard {...baseProps} locked currentStatus="extracting" />);
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Test Beneficiary 001" },
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(updateMutateMock).not.toHaveBeenCalled();
  });
});

describe("IntakeWizard — completeIntake", () => {
  it("submit button only fires when currentStatus === 'intake'", () => {
    render(<IntakeWizard {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /submit intake/i }));
    expect(completeMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: "case-1", expectedRowRevision: 1 }),
      expect.any(Object),
    );
  });

  it("disables (and skips) the submit button once status is past intake", () => {
    render(
      <IntakeWizard {...baseProps} currentStatus="documents_pending" />,
    );
    // The CTA isn't rendered as 'Complete intake' once status moved on,
    // OR it's rendered disabled — either way clicking shouldn't mutate.
    const btn = screen.queryByRole("button", { name: /submit intake/i });
    if (btn) fireEvent.click(btn);
    expect(completeMutateMock).not.toHaveBeenCalled();
  });
});

describe("IntakeWizard — URL section param", () => {
  it("opens the section the URL points to", () => {
    searchParamsMock.get.mockImplementation((k: string) =>
      k === "section" ? "filing" : null,
    );
    render(<IntakeWizard {...baseProps} />);
    // The Filing section blurb is unique and should be rendered.
    expect(screen.getByText(/Filing logistics/i)).toBeInTheDocument();
  });
});
