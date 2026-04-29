// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * `ApprovalActions` orchestrates 3 mutations: approve, unapprove,
 * downloadPdf. Branches:
 *   - approved=true → "Un-approve" button visible, "Approve" hidden
 *   - approved=false → "Approve" button visible
 *   - saveBeforeApprove=true → "Approve" disabled (prevents stale lock-in)
 *   - downloadPdf success → opens signed URL via window.open
 *   - any pending mutation → all buttons disabled
 */

const approveMutate = vi.hoisted(() => vi.fn());
const unapproveMutate = vi.hoisted(() => vi.fn());
const downloadMutate = vi.hoisted(() => vi.fn());
const useApproveMock = vi.hoisted(() =>
  vi.fn(() => ({ mutate: approveMutate, isPending: false })),
);
const useUnapproveMock = vi.hoisted(() =>
  vi.fn(() => ({ mutate: unapproveMutate, isPending: false })),
);
const useDownloadMock = vi.hoisted(() =>
  vi.fn(() => ({ mutate: downloadMutate, isPending: false })),
);
const utilsMock = vi.hoisted(() => ({
  output: {
    get: { invalidate: vi.fn(async () => undefined) },
    list: { invalidate: vi.fn(async () => undefined) },
  },
}));

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    useUtils: () => utilsMock,
    output: {
      approve: { useMutation: useApproveMock },
      unapprove: { useMutation: useUnapproveMock },
      downloadPdf: { useMutation: useDownloadMock },
    },
  },
}));

import { ApprovalActions } from "@/components/output/ApprovalActions";

afterEach(() => {
  cleanup();
  approveMutate.mockReset();
  unapproveMutate.mockReset();
  downloadMutate.mockReset();
  useApproveMock.mockReset();
  useUnapproveMock.mockReset();
  useDownloadMock.mockReset();
  useApproveMock.mockReturnValue({ mutate: approveMutate, isPending: false });
  useUnapproveMock.mockReturnValue({
    mutate: unapproveMutate,
    isPending: false,
  });
  useDownloadMock.mockReturnValue({
    mutate: downloadMutate,
    isPending: false,
  });
});

describe("ApprovalActions — toggle visibility", () => {
  it("shows 'Approve' when not approved", () => {
    render(
      <ApprovalActions
        outputId="o-1"
        attorneyApproved={false}
        saveBeforeApprove={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^approve$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /un-approve/i }),
    ).not.toBeInTheDocument();
  });

  it("shows 'Un-approve' when approved", () => {
    render(
      <ApprovalActions
        outputId="o-1"
        attorneyApproved={true}
        saveBeforeApprove={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /un-approve/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^approve$/i }),
    ).not.toBeInTheDocument();
  });
});

describe("ApprovalActions — approve gate", () => {
  it("Approve button is DISABLED when saveBeforeApprove=true (prevents stale lock-in)", () => {
    render(
      <ApprovalActions
        outputId="o-1"
        attorneyApproved={false}
        saveBeforeApprove={true}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^approve$/i }),
    ).toBeDisabled();
  });

  it("fires approve mutation when clicked", () => {
    render(
      <ApprovalActions
        outputId="o-9"
        attorneyApproved={false}
        saveBeforeApprove={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    expect(approveMutate).toHaveBeenCalledWith({ outputId: "o-9" });
  });

  it("fires unapprove mutation when clicked", () => {
    render(
      <ApprovalActions
        outputId="o-9"
        attorneyApproved={true}
        saveBeforeApprove={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /un-approve/i }));
    expect(unapproveMutate).toHaveBeenCalledWith({ outputId: "o-9" });
  });
});

describe("ApprovalActions — downloadPdf", () => {
  it("opens the signed URL in a new tab on success", () => {
    // Capture the onSuccess passed to useMutation so we can fire it.
    let capturedOnSuccess: ((data: { url: string }) => void) | null = null;
    useDownloadMock.mockImplementation((opts?: { onSuccess?: (d: { url: string }) => void }) => {
      capturedOnSuccess = opts?.onSuccess ?? null;
      return { mutate: downloadMutate, isPending: false };
    });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <ApprovalActions
        outputId="o-1"
        attorneyApproved={false}
        saveBeforeApprove={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    expect(downloadMutate).toHaveBeenCalledWith({ outputId: "o-1" });
    capturedOnSuccess?.({ url: "/signed-url-stub" });
    expect(openSpy).toHaveBeenCalledWith(
      "/signed-url-stub",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });
});

describe("ApprovalActions — pending serialization", () => {
  it("disables Download PDF when approve is in flight", () => {
    useApproveMock.mockReturnValue({ mutate: approveMutate, isPending: true });
    render(
      <ApprovalActions
        outputId="o-1"
        attorneyApproved={false}
        saveBeforeApprove={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /download pdf/i }),
    ).toBeDisabled();
  });
});
