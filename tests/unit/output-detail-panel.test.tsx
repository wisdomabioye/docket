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
const useUpdateMock = vi.hoisted(() =>
  vi.fn(() => ({ mutate: updateMutate, isPending: false })),
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

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    useUtils: () => utilsMock,
    output: {
      get: { useQuery: useGetMock },
      update: { useMutation: useUpdateMock },
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
vi.mock("@/components/output", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/output")
  >("@/components/output");
  return {
    ...actual,
    TiptapEditor: () => <div data-testid="tiptap-stub" />,
    useTiptapState: () => tiptapState,
  };
});

import { OutputDetailPanel } from "@/app/(app)/(workspace)/case/[id]/outputs/[outputId]/OutputDetailPanel";

afterEach(() => {
  cleanup();
  updateMutate.mockReset();
  useUpdateMock.mockReset();
  useUpdateMock.mockReturnValue({ mutate: updateMutate, isPending: false });
  useGetMock.mockReset();
  useGetMock.mockReturnValue({ data: undefined });
  tiptapApiMock.getMarkdown.mockReset();
  tiptapApiMock.setMarkdown.mockReset();
  tiptapState.isDirty = false;
  tiptapState.setDirty.mockReset();
  tiptapState.setApi.mockReset();
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
    attorneyApproved: false,
    approvedAt: null as string | null,
    updatedAt: "2026-04-29T12:00:00Z",
  },
};

describe("OutputDetailPanel — mode toggle", () => {
  it("starts in Read mode (Save button hidden)", () => {
    render(<OutputDetailPanel {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();
  });

  it("clicking Edit reveals Save + Cancel buttons", () => {
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(
      screen.getByRole("button", { name: /save changes/i }),
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
});

describe("OutputDetailPanel — Save flow", () => {
  it("Save button starts DISABLED when not dirty", () => {
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(
      screen.getByRole("button", { name: /save changes/i }),
    ).toBeDisabled();
  });

  it("Save button ENABLES when dirty=true", () => {
    tiptapState.isDirty = true;
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(
      screen.getByRole("button", { name: /save changes/i }),
    ).toBeEnabled();
  });

  it("Save with non-empty markdown calls update mutation", () => {
    tiptapState.isDirty = true;
    tiptapApiMock.getMarkdown.mockReturnValue("Edited body.");
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(updateMutate).toHaveBeenCalledWith({
      outputId: "out-1",
      content: "Edited body.",
    });
  });

  it("Save with whitespace-only markdown rejects locally (no mutation, error visible)", () => {
    tiptapState.isDirty = true;
    tiptapApiMock.getMarkdown.mockReturnValue("   \n   ");
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(updateMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be empty/i);
  });

  it("Save button label switches to 'Saving…' while pending", () => {
    tiptapState.isDirty = true;
    useUpdateMock.mockReturnValue({ mutate: updateMutate, isPending: true });
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
      screen.queryByRole("button", { name: /save changes/i }),
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
      screen.getByRole("button", { name: /save changes/i }),
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
      screen.queryByRole("button", { name: /save changes/i }),
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
        return { mutate: updateMutate, isPending: false };
      },
    );
    tiptapState.isDirty = true;
    tiptapApiMock.getMarkdown.mockReturnValue("Edited.");
    render(<OutputDetailPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await act(async () => {
      await captured.onSuccess?.();
    });
    expect(utilsMock.output.get.invalidate).toHaveBeenCalledWith({
      outputId: "out-1",
    });
    expect(tiptapState.setDirty).toHaveBeenCalledWith(false);
    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();
  });
});
