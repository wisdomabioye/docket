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
 * `OutputDetailPanel` — orchestrator that wires the editor + 4 sub-
 * components together. Branches reachable in the panel itself:
 *
 *   - Mode toggle: Read ↔ Edit. Edit button disabled when approved.
 *   - Save flow: empty content → BAD_REQUEST surfaced as saveError;
 *     happy path → mutate + reset to read mode.
 *   - Cancel flow: dirty + cancel-confirm cancels; cancel-accept calls
 *     setMarkdown(currentMarkdown) and returns to read.
 *   - Save button disabled when isDirty=false.
 *
 * Tiptap is mocked (the panel reads its API through the `useTiptapState`
 * hook; we substitute a stub that lets us drive isDirty / setMarkdown
 * deterministically). Sub-components are mocked at the trpc layer so
 * we exercise only the orchestrator's logic.
 */

const updateMutate = vi.hoisted(() => vi.fn());
const updateMutateAsync = vi.hoisted(() =>
  vi.fn<
    (args: { outputId: string; content: string }) => Promise<{
      ok: true;
      outputId: string;
      outputVersion: number;
    }>
  >(async () => ({ ok: true, outputId: "out-1", outputVersion: 2 })),
);
const useUpdateMock = vi.hoisted(() =>
  vi.fn(() => ({
    mutate: updateMutate,
    mutateAsync: updateMutateAsync,
    isPending: false,
  })),
);
const useGetMock = vi.hoisted(() =>
  vi.fn(
    (): {
      data:
        | {
            id: string;
            attorneyApproved: boolean;
            outputVersion: number;
            approvedAt: Date | null;
            content: string;
            updatedAt: Date;
          }
        | undefined;
    } => ({ data: undefined }),
  ),
);
const utilsMock = vi.hoisted(() => ({
  output: {
    get: { invalidate: vi.fn(async () => undefined) },
    list: { invalidate: vi.fn(async () => undefined) },
    listVersions: { invalidate: vi.fn(async () => undefined) },
  },
}));

// Stage 11 W3 autosave + clear-draft mocks. Hoisted to module scope so
// individual tests can drive them (call args, in-flight state, etc.)
// without redefining the whole tRPC mock.
const saveDraftMutateAsync = vi.hoisted(() =>
  vi.fn<
    (args: { outputId: string; content: string }) => Promise<{
      ok: true;
      saved: boolean;
    }>
  >(async () => ({ ok: true as const, saved: true })),
);
const useSaveDraftMock = vi.hoisted(() =>
  vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: saveDraftMutateAsync,
    isPending: false,
  })),
);
const clearDraftMutate = vi.hoisted(() => vi.fn());
const clearDraftMutateAsync = vi.hoisted(() =>
  vi.fn<
    (args: { outputId: string }) => Promise<{ ok: true; cleared: boolean }>
  >(async () => ({ ok: true, cleared: true })),
);
const useClearDraftMock = vi.hoisted(() =>
  vi.fn(() => ({
    mutate: clearDraftMutate,
    mutateAsync: clearDraftMutateAsync,
    isPending: false,
  })),
);

// `next/navigation`'s useRouter throws outside an App-Router context.
// Stub the methods the panel uses so the tests don't need a full
// router provider.
const routerReplace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplace,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    useUtils: () => utilsMock,
    output: {
      get: { useQuery: useGetMock },
      update: { useMutation: useUpdateMock },
      saveDraft: { useMutation: useSaveDraftMock },
      clearDraft: { useMutation: useClearDraftMock },
      // Mocks for components rendered inside the panel.
      regenerate: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      approve: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      unapprove: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      downloadPdf: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      restoreVersion: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      listVersions: {
        useQuery: vi.fn(() => ({ data: [], isLoading: false, isError: false })),
      },
    },
  },
}));

// The Tiptap editor mounts a real ProseMirror instance which is heavy.
// Stub the component + the hook so the orchestrator's logic is the
// thing under test.
const tiptapApiMock = vi.hoisted(() => ({
  getMarkdown: vi.fn(),
  setMarkdown: vi.fn(),
}));
const tiptapState = vi.hoisted(() => ({
  isDirty: false,
  setDirty: vi.fn(),
  api: tiptapApiMock,
  setApi: vi.fn(),
}));
// Capture the most-recent `onDirtyChange` prop the panel hands to
// TiptapEditor so tests can simulate "user typed" by invoking it.
// `null` until the editor mounts; reset in afterEach.
const lastOnDirtyChange = vi.hoisted(() => ({
  current: null as ((dirty: boolean) => void) | null,
}));
// Same pattern for ApprovalActions's `onApprovalChange` so the W4
// "navigate on approved-id-change" test can drive it.
const lastOnApprovalChange = vi.hoisted(() => ({
  current: null as ((newOutputId: string) => void) | null,
}));

vi.mock("@/components/output", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/output")
  >("@/components/output");
  return {
    ...actual,
    TiptapEditor: (props: { onDirtyChange?: (dirty: boolean) => void }) => {
      lastOnDirtyChange.current = props.onDirtyChange ?? null;
      return <div data-testid="tiptap-stub" />;
    },
    useTiptapState: () => tiptapState,
    ApprovalActions: (props: {
      onApprovalChange?: (newOutputId: string) => void;
    }) => {
      lastOnApprovalChange.current = props.onApprovalChange ?? null;
      return <div data-testid="approval-stub" />;
    },
  };
});

import { OutputDetailPanel } from "@/app/(app)/(workspace)/case/[id]/outputs/[outputId]/OutputDetailPanel";

afterEach(() => {
  cleanup();
  updateMutate.mockReset();
  updateMutateAsync.mockReset();
  updateMutateAsync.mockImplementation(async () => ({
    ok: true,
    outputId: "out-1",
    outputVersion: 2,
  }));
  useUpdateMock.mockReset();
  useUpdateMock.mockReturnValue({
    mutate: updateMutate,
    mutateAsync: updateMutateAsync,
    isPending: false,
  });
  useGetMock.mockReset();
  useGetMock.mockReturnValue({ data: undefined });
  tiptapApiMock.getMarkdown.mockReset();
  tiptapApiMock.setMarkdown.mockReset();
  tiptapState.isDirty = false;
  tiptapState.setDirty.mockReset();
  tiptapState.setApi.mockReset();
  saveDraftMutateAsync.mockReset();
  saveDraftMutateAsync.mockImplementation(async () => ({
    ok: true as const,
    saved: true,
  }));
  useSaveDraftMock.mockReset();
  useSaveDraftMock.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: saveDraftMutateAsync,
    isPending: false,
  });
  clearDraftMutate.mockReset();
  clearDraftMutateAsync.mockReset();
  clearDraftMutateAsync.mockImplementation(async () => ({
    ok: true,
    cleared: true,
  }));
  useClearDraftMock.mockReset();
  useClearDraftMock.mockReturnValue({
    mutate: clearDraftMutate,
    mutateAsync: clearDraftMutateAsync,
    isPending: false,
  });
  lastOnDirtyChange.current = null;
  lastOnApprovalChange.current = null;
  routerReplace.mockReset();
});

const baseProps = {
  caseId: "c-1",
  caseLabel: "Test Beneficiary 001 · O-1A",
  typeDisplayName: "Personal Statement",
  initialOutput: {
    id: "out-1",
    outputType: "personal_statement" as const,
    outputVersion: 1,
    subgroupKey: null as string | null,
    content: "# Title\n\nBody.",
    // `null` for prose types — only structured-output types
    // (`exhibit_index`) carry a server-formatted markdown view.
    displayContent: null as string | null,
    // Stage 11 W3 — no pending autosave by default; per-test overrides
    // can spread `{ ...baseProps.initialOutput, draftContent: "..." }`
    // to exercise the draft-recovery path.
    draftContent: null as string | null,
    attorneyApproved: false,
    approvedAt: null as string | null,
    updatedAt: "2026-04-29T12:00:00Z",
  },
};

describe("OutputDetailPanel — mode toggle", () => {
  it("starts in Read mode (Save button hidden)", () => {
    render(<OutputDetailPanel {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: /save version/i }),
    ).not.toBeInTheDocument();
  });

  it("clicking Edit reveals Save + Cancel buttons", () => {
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(
      screen.getByRole("button", { name: /save version/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^cancel$/i }),
    ).toBeInTheDocument();
  });

  it("Edit button is disabled when output is approved", () => {
    render(
      <OutputDetailPanel
        {...baseProps}
        initialOutput={{ ...baseProps.initialOutput, attorneyApproved: true }}
      />,
    );
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeDisabled();
  });

  it("Edit button is disabled for structured types (exhibit_index) with a 'coming soon' tooltip", () => {
    // Locks commit B's intermediate state: structured types are
    // read-only because TiptapEditor's markdown round-trip would
    // mangle the canonical JSON. Commit C swaps in the form editor.
    render(
      <OutputDetailPanel
        {...baseProps}
        initialOutput={{
          ...baseProps.initialOutput,
          outputType: "exhibit_index" as const,
          content: '{"entries":[]}',
          displayContent: "_No exhibits indexed yet — regenerate after uploading evidence._",
        }}
      />,
    );
    const editBtn = screen.getByRole("button", { name: /^edit$/i });
    expect(editBtn).toBeDisabled();
    expect(editBtn.getAttribute("title")).toMatch(/structured editor/i);
  });
});

describe("OutputDetailPanel — Save flow", () => {
  it("Save button starts DISABLED when not dirty", () => {
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(
      screen.getByRole("button", { name: /save version/i }),
    ).toBeDisabled();
  });

  it("Save button ENABLES when dirty=true", () => {
    tiptapState.isDirty = true;
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(
      screen.getByRole("button", { name: /save version/i }),
    ).toBeEnabled();
  });

  it("Save with non-empty markdown calls update mutation", async () => {
    tiptapState.isDirty = true;
    tiptapApiMock.getMarkdown.mockReturnValue("Edited body.");
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /save version/i }));
    // Save now serializes via inFlightRef → mutateAsync. Flush microtasks.
    await act(async () => {
      await Promise.resolve();
    });
    expect(updateMutateAsync).toHaveBeenCalledWith({
      outputId: "out-1",
      content: "Edited body.",
    });
  });

  it("Save with whitespace-only markdown rejects locally (no mutation, error visible)", () => {
    tiptapState.isDirty = true;
    tiptapApiMock.getMarkdown.mockReturnValue("   \n   ");
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /save version/i }));
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be empty/i);
  });

  it("Save button label switches to 'Saving…' while pending", () => {
    tiptapState.isDirty = true;
    useUpdateMock.mockReturnValue({
      mutate: updateMutate,
      mutateAsync: updateMutateAsync,
      isPending: true,
    });
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(
      screen.getByRole("button", { name: /saving/i }),
    ).toBeDisabled();
  });
});

describe("OutputDetailPanel — Cancel flow", () => {
  it("Cancel without dirty edits returns to Read mode immediately", () => {
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(
      screen.queryByRole("button", { name: /save version/i }),
    ).not.toBeInTheDocument();
  });

  it("Cancel with dirty edits prompts confirm; reject keeps Edit mode", () => {
    tiptapState.isDirty = true;
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => false);
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringMatching(/discard your edits/i),
    );
    // Still in Edit mode → Save button still rendered.
    expect(
      screen.getByRole("button", { name: /save version/i }),
    ).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("Cancel with dirty + accepted confirm calls setMarkdown(baseline) and returns to Read", () => {
    tiptapState.isDirty = true;
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(tiptapApiMock.setMarkdown).toHaveBeenCalledWith(
      baseProps.initialOutput.content,
    );
    expect(
      screen.queryByRole("button", { name: /save version/i }),
    ).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});

describe("OutputDetailPanel — header rendering", () => {
  it("renders the case label + display name + version pill", () => {
    render(<OutputDetailPanel {...baseProps} />);
    expect(
      screen.getByText("Test Beneficiary 001 · O-1A"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /personal statement/i }),
    ).toBeInTheDocument();
    // Version appears in header AND right-rail; assert at least once.
    expect(screen.getAllByText(/v1/).length).toBeGreaterThan(0);
  });

  it("renders the All Outputs back link", () => {
    render(<OutputDetailPanel {...baseProps} />);
    const link = screen.getByRole("link", { name: /all outputs/i });
    expect(link).toHaveAttribute("href", "/case/c-1/outputs");
  });
});

describe("OutputDetailPanel — live data refresh from output.get", () => {
  it("uses live attorneyApproved when query returns it (overrides initial)", () => {
    useGetMock.mockReturnValue({
      data: {
        id: "out-1",
        attorneyApproved: true,
        outputVersion: 5,
        approvedAt: new Date("2026-04-29T15:00:00Z"),
        content: "fresh",
        updatedAt: new Date("2026-04-29T15:00:00Z"),
      },
    });
    render(<OutputDetailPanel {...baseProps} />);
    // Edit disabled because attorneyApproved=true (from live data).
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeDisabled();
    // Version reflects live (v5 in both header + right-rail KV).
    expect(screen.getAllByText(/v5/).length).toBeGreaterThan(0);
    // Initial v1 should NOT appear anywhere.
    expect(screen.queryByText(/v1/)).not.toBeInTheDocument();
  });
});

describe("OutputDetailPanel — successful save reset (act-driven)", () => {
  it("calls onSuccess → invalidates → resets dirty + mode", async () => {
    const captured: {
      onSuccess: (() => Promise<void> | void) | null;
    } = { onSuccess: null };
    useUpdateMock.mockImplementation(
      (opts?: { onSuccess?: () => Promise<void> | void }) => {
        captured.onSuccess = opts?.onSuccess ?? null;
        return {
          mutate: updateMutate,
          mutateAsync: updateMutateAsync,
          isPending: false,
        };
      },
    );
    tiptapState.isDirty = true;
    tiptapApiMock.getMarkdown.mockReturnValue("Edited.");
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /save version/i }));
    await act(async () => {
      await captured.onSuccess?.();
    });
    expect(utilsMock.output.get.invalidate).toHaveBeenCalledWith({
      outputId: "out-1",
    });
    expect(tiptapState.setDirty).toHaveBeenCalledWith(false);
    expect(
      screen.queryByRole("button", { name: /save version/i }),
    ).not.toBeInTheDocument();
  });
});

describe("OutputDetailPanel — Stage 11 W3 autosave", () => {
  // The panel debounces autosave on a 3s timer. We use vi.useFakeTimers
  // per-test so we can advance virtual time without waiting in real life.
  // beforeEach swap is per-block so the existing `act-driven` save tests
  // (which rely on real timers for the React useState batching) stay
  // unaffected.

  it("opens in Edit mode + isDirty=true when initial draftContent differs from content", () => {
    render(
      <OutputDetailPanel
        {...baseProps}
        initialOutput={{
          ...baseProps.initialOutput,
          content: "baseline",
          draftContent: "in-progress draft text",
        }}
      />,
    );
    // Edit toolbar is visible (Save + Cancel rendered → mode === "edit").
    expect(
      screen.getByRole("button", { name: /save version/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^cancel$/i }),
    ).toBeInTheDocument();
    // The seed-dirty effect ran via tiptap.api callback. We can't mount a
    // real Tiptap, but the panel calls `tiptapState.setDirty(true)`
    // synchronously after editor api becomes available. We exposed
    // tiptapState.api as the mock api at module load, so the seed runs.
    expect(tiptapState.setDirty).toHaveBeenCalledWith(true);
  });

  it("does NOT open in Edit mode when draftContent equals content (clean baseline)", () => {
    render(
      <OutputDetailPanel
        {...baseProps}
        initialOutput={{
          ...baseProps.initialOutput,
          content: "same",
          draftContent: "same",
        }}
      />,
    );
    // Read mode → Save version button absent.
    expect(
      screen.queryByRole("button", { name: /save version/i }),
    ).not.toBeInTheDocument();
  });

  it("typing while in Edit mode schedules a debounced saveDraft mutation after 3s", async () => {
    vi.useFakeTimers();
    try {
      tiptapApiMock.getMarkdown.mockReturnValue("typed text");
      render(<OutputDetailPanel {...baseProps} />);
      fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

      // The TiptapEditor stub captures the panel-supplied
      // `onDirtyChange` prop. Invoking it = "user typed" — fires the
      // panel's wrapper which schedules the autosave debounce.
      expect(lastOnDirtyChange.current).not.toBeNull();
      act(() => {
        lastOnDirtyChange.current?.(true);
      });

      // 2s in: debounce hasn't fired yet.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(saveDraftMutateAsync).not.toHaveBeenCalled();

      // Past the 3s threshold: timer fires, mutateAsync dispatches.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(saveDraftMutateAsync).toHaveBeenCalledWith({
        outputId: "out-1",
        content: "typed text",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rapid keystrokes within 3s collapse to a SINGLE saveDraft call", async () => {
    vi.useFakeTimers();
    try {
      tiptapApiMock.getMarkdown.mockReturnValue("final text");
      render(<OutputDetailPanel {...baseProps} />);
      fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

      // Three "keystrokes" inside the debounce window — the timer
      // resets each time, so only ONE saveDraft should fire.
      for (let i = 0; i < 3; i++) {
        act(() => {
          lastOnDirtyChange.current?.(true);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      // Now wait the full 3s with no further input.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500);
      });
      expect(saveDraftMutateAsync).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Cancel calls clearDraft + restores baseline locally", async () => {
    tiptapState.isDirty = true;
    render(
      <OutputDetailPanel
        {...baseProps}
        initialOutput={{
          ...baseProps.initialOutput,
          content: "baseline",
          draftContent: "in-progress",
        }}
      />,
    );
    // Confirm dialog auto-accepts.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
      // Cancel chains via inFlightRef → mutateAsync; flush microtasks
      // for the chained promise to fire.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(clearDraftMutateAsync).toHaveBeenCalledWith({
        outputId: "out-1",
      });
      // Editor is restored to the committed baseline, not the draft.
      expect(tiptapApiMock.setMarkdown).toHaveBeenCalledWith("baseline");
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("Save version pre-empts a queued autosave so the timer can't double-write", async () => {
    vi.useFakeTimers();
    try {
      tiptapApiMock.getMarkdown.mockReturnValue("ready to commit");
      tiptapState.isDirty = true;
      render(<OutputDetailPanel {...baseProps} />);
      fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

      // Simulate "user typed" → schedules autosave for 3s out.
      act(() => {
        lastOnDirtyChange.current?.(true);
      });
      // Click Save BEFORE the 3s timer fires. handleSave should
      // clearTimeout the queued autosave, then dispatch update via
      // the inFlightRef chain.
      fireEvent.click(screen.getByRole("button", { name: /save version/i }));
      // Advance past 3s — a leaked timer would fire here and double up.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500);
      });
      expect(updateMutateAsync).toHaveBeenCalledTimes(1);
      expect(saveDraftMutateAsync).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Save serializes behind an in-flight autosave (queued, not fired in parallel)", async () => {
    vi.useFakeTimers();
    try {
      // Make the autosave hold the chain open. Save should QUEUE, not
      // race in parallel — the regression we're guarding against had
      // saveDraft + update arriving at the server in either order,
      // surfacing a confusing "non-current version" error after a
      // successful Save.
      saveDraftMutateAsync.mockImplementationOnce(
        () =>
          new Promise<{ ok: true; saved: boolean }>(() => {
            // Never resolves — this is the in-flight state we exercise.
          }),
      );
      tiptapApiMock.getMarkdown.mockReturnValue("typed text");
      render(<OutputDetailPanel {...baseProps} />);
      fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

      act(() => {
        lastOnDirtyChange.current?.(true);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
      expect(saveDraftMutateAsync).toHaveBeenCalledTimes(1);

      // Click Save while autosave is still in flight.
      fireEvent.click(screen.getByRole("button", { name: /save version/i }));
      await act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
      });
      // Save is queued behind the autosave — not dispatched in
      // parallel. The autosave never resolves in this test so Save
      // stays queued indefinitely; what matters is it didn't race.
      expect(updateMutateAsync).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // W4 — when the server flushes a pending draft on Approve, the
  // URL's outputId now points at the prior (non-current) version. The
  // panel must router.replace to the new id so the user lands on the
  // row they just approved.
  it("router.replace fires when ApprovalActions reports a new approved id", () => {
    render(<OutputDetailPanel {...baseProps} />);
    expect(lastOnApprovalChange.current).not.toBeNull();
    // No-op on same id (e.g. unapprove or no-draft approve).
    act(() => {
      lastOnApprovalChange.current?.(baseProps.initialOutput.id);
    });
    expect(routerReplace).not.toHaveBeenCalled();
    // Different id (server flushed draft → new version) → navigate.
    act(() => {
      lastOnApprovalChange.current?.("new-output-id");
    });
    expect(routerReplace).toHaveBeenCalledWith(
      `/case/${baseProps.caseId}/outputs/new-output-id`,
    );
  });

  it("Cancel pre-empts a queued autosave", async () => {
    vi.useFakeTimers();
    try {
      tiptapState.isDirty = true;
      render(<OutputDetailPanel {...baseProps} />);
      fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
      act(() => {
        lastOnDirtyChange.current?.(true);
      });
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      try {
        fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3500);
        });
        // Cancel ran clearDraft via the inFlightRef chain; the leaked
        // timer would have called saveDraft and clobbered it.
        expect(clearDraftMutateAsync).toHaveBeenCalledTimes(1);
        expect(saveDraftMutateAsync).not.toHaveBeenCalled();
      } finally {
        confirmSpy.mockRestore();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
