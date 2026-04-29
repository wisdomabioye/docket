// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * `RegeneratePanel` has 4 reachable branches we can lock at unit
 * level (without mounting the full TRPC provider):
 *
 *   1. `outputType === "recommendation_letter_template"` →
 *      panel hides the form entirely; an explanatory message renders.
 *   2. Default render → guidance textarea + Regenerate button.
 *   3. Click with `isDirty=true` → confirm dialog; cancel skips
 *      the mutation, accept fires it.
 *   4. Mutation in flight → button label switches + disabled.
 */

const mutateMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() =>
  vi.fn(() => ({
    mutate: mutateMock,
    isPending: false,
    reset: vi.fn(),
  })),
);

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    output: {
      regenerate: {
        useMutation: useMutationMock,
      },
    },
  },
}));

import { RegeneratePanel } from "@/components/output/RegeneratePanel";

afterEach(() => {
  cleanup();
  mutateMock.mockReset();
  useMutationMock.mockReset();
  useMutationMock.mockReturnValue({
    mutate: mutateMock,
    isPending: false,
    reset: vi.fn(),
  });
});

describe("RegeneratePanel — output-type early return", () => {
  it("hides the form for recommendation_letter_template (open_issues #20)", () => {
    render(
      <RegeneratePanel
        outputId="o-1"
        outputType="recommendation_letter_template"
        isDirty={false}
      />,
    );
    expect(
      screen.getByText(/regenerate isn['’]t available/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("RegeneratePanel — guidance + click", () => {
  it("renders the textarea + Regenerate button", () => {
    render(
      <RegeneratePanel
        outputId="o-1"
        outputType="personal_statement"
        isDirty={false}
      />,
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /regenerate/i })).toBeInTheDocument();
  });

  it("fires mutate without guidance when textarea empty", () => {
    render(
      <RegeneratePanel
        outputId="o-1"
        outputType="personal_statement"
        isDirty={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    expect(mutateMock).toHaveBeenCalledWith({ outputId: "o-1" });
  });

  it("trims + forwards guidance when present", () => {
    render(
      <RegeneratePanel
        outputId="o-2"
        outputType="petition_letter"
        isDirty={false}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  add citations  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    expect(mutateMock).toHaveBeenCalledWith({
      outputId: "o-2",
      guidance: "add citations",
    });
  });

  it("caps guidance at 5000 chars (per Zod input)", () => {
    render(
      <RegeneratePanel
        outputId="o-3"
        outputType="petition_letter"
        isDirty={false}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "x".repeat(7000) } });
    expect(textarea.value.length).toBe(5000);
  });
});

describe("RegeneratePanel — unsaved-edits confirm", () => {
  it("blocks regenerate when isDirty=true and user cancels confirm", () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => false);
    render(
      <RegeneratePanel outputId="o-1" outputType="personal_statement" isDirty={true} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringMatching(/unsaved edits/i),
    );
    expect(mutateMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("proceeds with regenerate when isDirty=true and user accepts confirm", () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    render(
      <RegeneratePanel outputId="o-1" outputType="personal_statement" isDirty={true} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    expect(mutateMock).toHaveBeenCalledWith({ outputId: "o-1" });
    confirmSpy.mockRestore();
  });
});

describe("RegeneratePanel — pending state", () => {
  it("disables button + shows 'Queuing…' while in flight", () => {
    useMutationMock.mockReturnValue({
      mutate: mutateMock,
      isPending: true,
      reset: vi.fn(),
    });
    render(
      <RegeneratePanel
        outputId="o-1"
        outputType="personal_statement"
        isDirty={false}
      />,
    );
    const button = screen.getByRole("button", { name: /queuing/i });
    expect(button).toBeDisabled();
  });
});
