// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mutateMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() =>
  vi.fn(() => ({
    mutate: mutateMock,
    isPending: false,
    reset: vi.fn(),
  })),
);

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    case: {
      markFiled: {
        useMutation: useMutationMock,
      },
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { MarkFiledCard } from "@/components/case/MarkFiledCard";

afterEach(() => {
  cleanup();
  mutateMock.mockReset();
  refreshMock.mockReset();
  useMutationMock.mockReset();
  useMutationMock.mockReturnValue({
    mutate: mutateMock,
    isPending: false,
    reset: vi.fn(),
  });
});

describe("MarkFiledCard — visibility", () => {
  const otherStatuses = [
    "intake",
    "documents_pending",
    "extracting",
    "ready_to_build",
    "building",
    "build_failed",
    "draft_ready",
    "in_review",
    "needs_revision",
    "approved",
    "package_ready",
    "filed",
    "archived",
  ] as const;

  for (const s of otherStatuses) {
    it(`renders nothing when status is ${s}`, () => {
      const { container } = render(
        <MarkFiledCard caseId="c-1" caseStatus={s} />,
      );
      expect(container.firstChild).toBeNull();
    });
  }

  it("renders the form when status is delivered", () => {
    render(<MarkFiledCard caseId="c-1" caseStatus="delivered" />);
    expect(screen.getByLabelText(/USCIS receipt number/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /mark as filed/i }),
    ).toBeInTheDocument();
  });
});

describe("MarkFiledCard — submission", () => {
  it("submits with no receipt when input is left blank", () => {
    render(<MarkFiledCard caseId="c-1" caseStatus="delivered" />);
    fireEvent.click(screen.getByRole("button", { name: /mark as filed/i }));
    expect(mutateMock).toHaveBeenCalledWith({ caseId: "c-1" });
  });

  it("submits with the trimmed receipt number when provided", () => {
    render(<MarkFiledCard caseId="c-1" caseStatus="delivered" />);
    fireEvent.change(screen.getByLabelText(/USCIS receipt number/i), {
      target: { value: "  MSC2200000001  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /mark as filed/i }));
    expect(mutateMock).toHaveBeenCalledWith({
      caseId: "c-1",
      receiptNumber: "MSC2200000001",
    });
  });

  it("disables the button while the mutation is pending", () => {
    useMutationMock.mockReturnValue({
      mutate: mutateMock,
      isPending: true,
      reset: vi.fn(),
    });
    render(<MarkFiledCard caseId="c-1" caseStatus="delivered" />);
    const button = screen.getByRole("button", { name: /marking…/i });
    expect(button).toBeDisabled();
  });

  it("surfaces the server error message verbatim", () => {
    let onErrorCallback: ((err: { message: string }) => void) | null = null;
    useMutationMock.mockImplementation((...args: unknown[]) => {
      const opts = args[0] as
        | { onError?: (err: { message: string }) => void }
        | undefined;
      onErrorCallback = opts?.onError ?? null;
      return {
        mutate: mutateMock,
        isPending: false,
        reset: vi.fn(),
      };
    });
    render(<MarkFiledCard caseId="c-1" caseStatus="delivered" />);
    act(() => {
      onErrorCallback?.({
        message:
          "USCIS receipt number is already on file for another case. Double-check the number — receipts are globally unique.",
      });
    });
    expect(
      screen.getByText(/already on file for another case/i),
    ).toBeInTheDocument();
  });
});
