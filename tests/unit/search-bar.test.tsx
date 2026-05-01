// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * `SearchBar` (Stage 11 W5) — global topbar autocomplete. Tests pin
 * the contract between the input and the `trpc.search.global` query
 * hook, plus the keyboard interactions a power user relies on.
 *
 * Tiptap-style approach: mock the trpc client + Next router, drive
 * keyboard / click events against the real component, assert on the
 * mocks. The trigram SQL itself is covered by the integration test.
 */

const useGlobalMock = vi.hoisted(() =>
  vi.fn(
    (): {
      data:
        | {
            cases: ReadonlyArray<{
              id: string;
              beneficiaryName: string;
              visaType: string;
              status: string;
              similarity: number;
            }>;
            documents: ReadonlyArray<{
              id: string;
              caseId: string;
              filename: string;
              snippet: string;
              similarity: number;
            }>;
          }
        | undefined;
      isFetching: boolean;
    } => ({ data: undefined, isFetching: false }),
  ),
);

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    search: {
      global: { useQuery: useGlobalMock },
    },
  },
}));

const routerPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { SearchBar } from "@/components/layout/SearchBar";

afterEach(() => {
  cleanup();
  useGlobalMock.mockReset();
  useGlobalMock.mockReturnValue({ data: undefined, isFetching: false });
  routerPush.mockReset();
});

const sampleResults = {
  cases: [
    {
      id: "case-1",
      beneficiaryName: "Maria Gonzalez",
      visaType: "O-1A",
      status: "draft_ready",
      similarity: 0.9,
    },
    {
      id: "case-2",
      beneficiaryName: "Mariam Hassan",
      visaType: "EB-1A",
      status: "intake",
      similarity: 0.5,
    },
  ],
  documents: [
    {
      id: "doc-1",
      caseId: "case-1",
      filename: "personal_statement.pdf",
      snippet: "personal_statement.pdf",
      similarity: 0.4,
    },
  ],
};

describe("SearchBar — debounce", () => {
  it("does NOT call useQuery's fetch path until the input is past the min length AND the debounce settles", () => {
    vi.useFakeTimers();
    try {
      render(<SearchBar />);
      const input = screen.getByRole("combobox") as HTMLInputElement;

      // Single character: below MIN_QUERY_LENGTH=2. useQuery is
      // called every render but with `enabled: false` — last call's
      // `enabled` arg should be false.
      fireEvent.change(input, { target: { value: "m" } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      const callsAfter1Char = useGlobalMock.mock.calls.length;
      const lastEnabled = (useGlobalMock.mock.calls[callsAfter1Char - 1] ??
        []) as ReadonlyArray<unknown>;
      expect((lastEnabled[1] as { enabled?: boolean } | undefined)?.enabled).toBe(false);

      // Two chars: enables query AFTER the 250ms debounce only.
      fireEvent.change(input, { target: { value: "ma" } });
      // Just before debounce fires.
      act(() => {
        vi.advanceTimersByTime(200);
      });
      const beforeDebounce = useGlobalMock.mock.calls.length;
      const beforeDebounceLast = (useGlobalMock.mock.calls[beforeDebounce - 1] ??
        []) as ReadonlyArray<unknown>;
      expect(
        (beforeDebounceLast[1] as { enabled?: boolean } | undefined)?.enabled,
      ).toBe(false);
      // Past the debounce — enabled flips true.
      act(() => {
        vi.advanceTimersByTime(100);
      });
      const afterDebounceCalls = useGlobalMock.mock.calls;
      const afterDebounceLast = (afterDebounceCalls[
        afterDebounceCalls.length - 1
      ] ?? []) as ReadonlyArray<unknown>;
      expect(
        (afterDebounceLast[1] as { enabled?: boolean } | undefined)?.enabled,
      ).toBe(true);
      // Query input matches what the user typed (debounced).
      expect((afterDebounceLast[0] as { q?: string }).q).toBe("ma");
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Render + type "maria" + flush the 250ms debounce so the dropdown
 *  is visible and the activeIndex points at the first hit. */
function renderWithResults(): { input: HTMLInputElement } {
  vi.useFakeTimers();
  useGlobalMock.mockReturnValue({ data: sampleResults, isFetching: false });
  render(<SearchBar />);
  const input = screen.getByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "maria" } });
  act(() => {
    vi.advanceTimersByTime(300);
  });
  return { input };
}

describe("SearchBar — dropdown visibility", () => {
  it("renders nothing under 2 chars even on focus", () => {
    render(<SearchBar />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "m" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("renders the listbox once results load", () => {
    try {
      renderWithResults();
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      expect(screen.getByText("Maria Gonzalez")).toBeInTheDocument();
      expect(screen.getByText("personal_statement.pdf")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Escape closes the dropdown but keeps the typed query", () => {
    try {
      const { input } = renderWithResults();
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(input.value).toBe("maria");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SearchBar — keyboard nav + navigation", () => {
  it("Enter on the highlighted case row navigates to /case/[id]", () => {
    try {
      const { input } = renderWithResults();
      // Default activeIndex=0 → first case.
      fireEvent.keyDown(input, { key: "Enter" });
      expect(routerPush).toHaveBeenCalledWith("/case/case-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ArrowDown moves the active item; Enter on the document row navigates to /case/[caseId]/documents", () => {
    try {
      const { input } = renderWithResults();
      // Hits flat order: case-1, case-2, doc-1. Two downs lands on doc.
      fireEvent.keyDown(input, { key: "ArrowDown" }); // → case-2
      fireEvent.keyDown(input, { key: "ArrowDown" }); // → doc-1
      fireEvent.keyDown(input, { key: "Enter" });
      expect(routerPush).toHaveBeenCalledWith("/case/case-1/documents");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ArrowDown wraps from last back to first", () => {
    try {
      const { input } = renderWithResults();
      fireEvent.keyDown(input, { key: "ArrowDown" }); // case-2
      fireEvent.keyDown(input, { key: "ArrowDown" }); // doc-1
      fireEvent.keyDown(input, { key: "ArrowDown" }); // wrap to case-1
      fireEvent.keyDown(input, { key: "Enter" });
      expect(routerPush).toHaveBeenCalledWith("/case/case-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the query after navigation", () => {
    try {
      const { input } = renderWithResults();
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input.value).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ArrowDown after the result set shrinks moves on the FIRST press (regression: stale activeIndexRaw)", () => {
    // Repro: user has activeIndex=2 in a 3-row list, then types a more
    // specific query and the list shrinks to 1 row. Without the fix,
    // the first ↓ uses the stale raw=2 → (2+1)%1 = 0 (no movement
    // since clamped activeIndex was already 0). With the fix, the
    // closure's clamped activeIndex (=0) is used → (0+1)%1 = 0 too,
    // BUT in the 2-row shrink case below it produces the right move.
    vi.useFakeTimers();
    try {
      // Start with 3 rows and walk activeIndex to the last (raw=2).
      useGlobalMock.mockReturnValue({
        data: sampleResults,
        isFetching: false,
      });
      const { rerender } = render(<SearchBar />);
      const input = screen.getByRole("combobox") as HTMLInputElement;
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "maria" } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      fireEvent.keyDown(input, { key: "ArrowDown" }); // raw=1
      fireEvent.keyDown(input, { key: "ArrowDown" }); // raw=2 (last row)

      // Now shrink the result set to a single row. ActiveIndex clamps
      // to 0; activeIndexRaw stays at 2.
      useGlobalMock.mockReturnValue({
        data: {
          cases: [sampleResults.cases[0]!],
          documents: [],
        },
        isFetching: false,
      });
      rerender(<SearchBar />);

      // Press ↓ — should wrap to 0 (the only row) and Enter must fire
      // navigation. Without the fix the raw=2 → (2+1)%1=0 also lands
      // on 0, so the bug doesn't manifest at length=1; switch to
      // length=2 to exercise it.
      useGlobalMock.mockReturnValue({
        data: {
          cases: [sampleResults.cases[0]!, sampleResults.cases[1]!],
          documents: [],
        },
        isFetching: false,
      });
      rerender(<SearchBar />);
      // raw is still 2; clamped is 1 (last). ↓ should wrap to 0
      // (case-1). Pre-fix: (2+1)%2 = 1 — STAYS on the same row.
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(routerPush).toHaveBeenCalledWith("/case/case-1");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SearchBar — Cmd+K / Ctrl+K shortcut", () => {
  it("Cmd+K on window focuses the input even when it's not focused", () => {
    render(<SearchBar />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    // Confirm not focused initially.
    expect(document.activeElement).not.toBe(input);
    // Dispatch a global Cmd+K keydown.
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(document.activeElement).toBe(input);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Ctrl+K (non-mac) also focuses the input", () => {
    render(<SearchBar />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    const event = new KeyboardEvent("keydown", {
      key: "K",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(document.activeElement).toBe(input);
  });

  it("plain `k` keystroke does NOT hijack focus", () => {
    render(<SearchBar />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);
    const event = new KeyboardEvent("keydown", {
      key: "k",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(document.activeElement).not.toBe(input);
    expect(event.defaultPrevented).toBe(false);
  });
});
