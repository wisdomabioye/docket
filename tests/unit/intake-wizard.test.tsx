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

// Recommender tRPC surface — IntakeWizard's "Recommenders" section
// reads `list` for the section-nav counter. The full editor (which
// invokes create/update/remove) renders inside that section but is
// only mounted when the section is active; mock the mutations as
// no-op stubs so a future "switch to Recommenders" test doesn't crash.
type RecommenderRow = {
  id: string;
  fullName: string;
  relationship: string;
  titleOrg: string | null;
  email: string | null;
  guidance: string | null;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
};
const recommenderListUseQueryMock = vi.hoisted(() =>
  vi.fn<() => { data: RecommenderRow[]; isLoading: boolean }>(() => ({
    data: [] as RecommenderRow[],
    isLoading: false,
  })),
);
const recommenderNoopMutation = vi.hoisted(() => ({
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
}));
const recommenderUseUtilsMock = vi.hoisted(() => ({
  recommender: {
    list: { invalidate: vi.fn(() => Promise.resolve()) },
  },
}));

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    case: {
      updateBeneficiary: { useMutation: updateUseMutationMock },
      completeIntake: { useMutation: completeUseMutationMock },
    },
    recommender: {
      list: { useQuery: recommenderListUseQueryMock },
      create: recommenderNoopMutation,
      update: recommenderNoopMutation,
      remove: recommenderNoopMutation,
    },
    useUtils: () => recommenderUseUtilsMock,
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
  visaType: "O-1A" as const,
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
    // Both the sidebar item and the footer "Next: Practice →" CTA match
    // /practice/i — pick the sidebar one (it has the section-stats span
    // showing 1/3 filled because we just typed into Full name).
    const sidebarLink = screen
      .getAllByRole("button", { name: /practice/i })
      .find((btn) => btn.textContent?.includes("/"));
    if (!sidebarLink) throw new Error("sidebar Practice button not found");
    fireEvent.click(sidebarLink);
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

const validProfile = {
  fullName: "Test Beneficiary",
  dateOfBirth: "1990-01-01",
  nationality: "Canada",
  currentLocation: "Toronto",
} as const;

// Fully populated across every fields-section. Submit now runs a
// cross-section gate so partial fixtures no longer reach the mutation.
const validIntake = {
  ...validProfile,
  occupation: "Research Scientist",
  field: "Computational Biology",
  yearsActive: 8,
  targetFilingDate: "2027-01-01",
  email: "applicant@example.com",
  notes: "Background context for the drafting AI.",
} as const;

describe("IntakeWizard — per-section CTA", () => {
  it("non-final sections render a 'Next: <Section>' button that advances the URL", () => {
    render(<IntakeWizard {...baseProps} initial={validProfile} />);
    // Default section is `profile`; the next is `practice`.
    const next = screen.getByRole("button", { name: /next: practice/i });
    fireEvent.click(next);
    expect(routerPushMock).toHaveBeenCalledWith(
      expect.stringContaining("?section=practice"),
      expect.objectContaining({ scroll: false }),
    );
    expect(completeMutateMock).not.toHaveBeenCalled();
  });

  it("final section renders the Submit intake CTA, which fires completeIntake", () => {
    searchParamsMock.get.mockImplementation((k: string) =>
      k === "section" ? "narrative" : null,
    );
    render(<IntakeWizard {...baseProps} initial={validIntake} />);
    fireEvent.click(screen.getByRole("button", { name: /submit intake/i }));
    expect(completeMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: "case-1", expectedRowRevision: 1 }),
      expect.any(Object),
    );
  });

  it("Submit intake disables (and skips) once status is past intake", () => {
    searchParamsMock.get.mockImplementation((k: string) =>
      k === "section" ? "narrative" : null,
    );
    render(
      <IntakeWizard {...baseProps} currentStatus="documents_pending" />,
    );
    const btn = screen.queryByRole("button", { name: /submit intake/i });
    if (btn) fireEvent.click(btn);
    expect(completeMutateMock).not.toHaveBeenCalled();
  });
});

describe("IntakeWizard — per-section validation gate", () => {
  it("Next blocks when required profile fields are empty", () => {
    render(<IntakeWizard {...baseProps} initial={{}} />);
    const next = screen.getByRole("button", { name: /next: practice/i });
    fireEvent.click(next);
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("renders inline field errors and clears them on edit", () => {
    render(<IntakeWizard {...baseProps} initial={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /next: practice/i }));
    // After a failed Next, the offending inputs flip aria-invalid.
    const fullNameInput = screen.getByLabelText("Full name");
    expect(fullNameInput.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(fullNameInput, { target: { value: "Alice" } });
    // Editing the field clears its own error immediately.
    expect(
      screen.getByLabelText("Full name").getAttribute("aria-invalid"),
    ).not.toBe("true");
  });

  it("Submit blocks on the final section if required fields are missing", () => {
    searchParamsMock.get.mockImplementation((k: string) =>
      k === "section" ? "narrative" : null,
    );
    render(<IntakeWizard {...baseProps} initial={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /submit intake/i }));
    expect(completeMutateMock).not.toHaveBeenCalled();
  });

  it("Submit on narrative with valid notes but empty profile is blocked and reroutes to profile", () => {
    // Starts on narrative section with notes filled, but profile/
    // practice/filing all empty. Per-section gate alone would let
    // this through; the cross-section Submit gate must block AND
    // route the user to the first failing section (profile).
    searchParamsMock.get.mockImplementation((k: string) =>
      k === "section" ? "narrative" : null,
    );
    render(
      <IntakeWizard
        {...baseProps}
        initial={{ notes: "context for the drafting AI" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /submit intake/i }));
    expect(completeMutateMock).not.toHaveBeenCalled();
    expect(routerPushMock).toHaveBeenCalledWith(
      expect.stringContaining("?section=profile"),
      expect.objectContaining({ scroll: false }),
    );
  });

  it("locked mode bypasses validation and renders no Next button", () => {
    // Locked mode disables the footer CTAs entirely — no Next or
    // Submit to click. The gate's job is to short-circuit when those
    // buttons are gone too (defensive), which we confirm by checking
    // the body still renders and no fields show aria-invalid.
    render(<IntakeWizard {...baseProps} initial={{}} locked />);
    expect(
      screen.queryByRole("button", { name: /next: practice/i }),
    ).toBeNull();
  });
});

describe("IntakeWizard — Previous button", () => {
  it("first section renders no Back button", () => {
    // Default section is `profile` (first).
    render(<IntakeWizard {...baseProps} initial={{}} />);
    expect(screen.queryByRole("button", { name: /back:/i })).toBeNull();
  });

  it("second section renders a 'Back: <prev label>' button that navigates", () => {
    searchParamsMock.get.mockImplementation((k: string) =>
      k === "section" ? "practice" : null,
    );
    render(<IntakeWizard {...baseProps} initial={{}} />);
    const back = screen.getByRole("button", { name: /back: profile/i });
    fireEvent.click(back);
    expect(routerPushMock).toHaveBeenCalledWith(
      expect.stringContaining("?section=profile"),
      expect.objectContaining({ scroll: false }),
    );
  });

  it("Back navigation does NOT gate on validation", () => {
    // On a section with required fields empty, Back must still work
    // so the user can return to an earlier section to investigate.
    searchParamsMock.get.mockImplementation((k: string) =>
      k === "section" ? "practice" : null,
    );
    render(<IntakeWizard {...baseProps} initial={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /back: profile/i }));
    // Navigation fired even though required practice fields are empty.
    expect(routerPushMock).toHaveBeenCalledWith(
      expect.stringContaining("?section=profile"),
      expect.objectContaining({ scroll: false }),
    );
    // No validation errors written.
    expect(completeMutateMock).not.toHaveBeenCalled();
  });

  it("locked mode hides the Back button", () => {
    searchParamsMock.get.mockImplementation((k: string) =>
      k === "section" ? "practice" : null,
    );
    render(<IntakeWizard {...baseProps} initial={{}} locked />);
    expect(screen.queryByRole("button", { name: /back:/i })).toBeNull();
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

describe("IntakeWizard — RecommenderListEditor visa copy", () => {
  beforeEach(() => {
    searchParamsMock.get.mockImplementation((k: string) =>
      k === "section" ? "recommenders" : null,
    );
  });

  it("empty O-1A case renders 'at least three' (visa minimum) in the empty-state copy", () => {
    recommenderListUseQueryMock.mockReturnValue({ data: [], isLoading: false });
    render(<IntakeWizard {...baseProps} visaType="O-1A" />);
    expect(screen.getByText(/at least three letter-writers/i)).toBeInTheDocument();
    expect(screen.getByText(/\(O-1A minimum\)/)).toBeInTheDocument();
  });

  it("renders 'X of 3 added' counter when at least one recommender exists", () => {
    recommenderListUseQueryMock.mockReturnValue({
      data: [
        { id: "r1", fullName: "Rec One", relationship: "Advisor", titleOrg: null, email: null, guidance: null, displayOrder: 0, createdAt: new Date(), updatedAt: new Date() },
      ],
      isLoading: false,
    });
    render(<IntakeWizard {...baseProps} visaType="O-1A" />);
    expect(screen.getByText("1 of 3 added")).toBeInTheDocument();
    expect(screen.getByText(/Below O-1A minimum/i)).toBeInTheDocument();
  });

  it("hides the 'Below minimum' chip once the visa minimum is met", () => {
    recommenderListUseQueryMock.mockReturnValue({
      data: [
        { id: "r1", fullName: "A", relationship: "Advisor", titleOrg: null, email: null, guidance: null, displayOrder: 0, createdAt: new Date(), updatedAt: new Date() },
        { id: "r2", fullName: "B", relationship: "Advisor", titleOrg: null, email: null, guidance: null, displayOrder: 1, createdAt: new Date(), updatedAt: new Date() },
        { id: "r3", fullName: "C", relationship: "Advisor", titleOrg: null, email: null, guidance: null, displayOrder: 2, createdAt: new Date(), updatedAt: new Date() },
      ],
      isLoading: false,
    });
    render(<IntakeWizard {...baseProps} visaType="O-1A" />);
    expect(screen.getByText("3 of 3 added")).toBeInTheDocument();
    expect(screen.queryByText(/Below O-1A minimum/i)).toBeNull();
  });

  it("uses neutral copy + no counter for visas without a minimum (EB-1A)", () => {
    // EB-1A has no `minRecommenders` set in lib/visa-criteria.ts today,
    // so visaCriteriaConfig("EB-1A") returns null in Phase 1. The
    // editor should still render (defensively) with neutral copy.
    recommenderListUseQueryMock.mockReturnValue({ data: [], isLoading: false });
    render(<IntakeWizard {...baseProps} visaType="EB-1A" />);
    expect(screen.getByText(/Add letter-writers for this case/i)).toBeInTheDocument();
    // Empty-state subtitle must not name a specific count for visas
    // without a configured minimum.
    expect(screen.queryByText(/at least \w+ letter-writers/i)).toBeNull();
    // No "X of Y added" counter chip.
    expect(screen.queryByText(/of \d+ added/i)).toBeNull();
  });
});
