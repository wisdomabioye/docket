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

const downloadMutate = vi.hoisted(() => vi.fn());
const useDownloadMock = vi.hoisted(() =>
  vi.fn(() => ({ mutate: downloadMutate, isPending: false })),
);

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    output: {
      downloadPackage: { useMutation: useDownloadMock },
    },
  },
}));

import { PackageDownloadButton } from "@/app/(app)/case/[id]/package/PackageDownloadButton";

afterEach(() => {
  cleanup();
  downloadMutate.mockReset();
  useDownloadMock.mockReset();
  useDownloadMock.mockReturnValue({
    mutate: downloadMutate,
    isPending: false,
  });
});

describe("PackageDownloadButton", () => {
  it("renders 'Download package' label", () => {
    render(<PackageDownloadButton caseId="c-1" />);
    expect(
      screen.getByRole("button", { name: /download package/i }),
    ).toBeInTheDocument();
  });

  it("fires downloadPackage mutation with caseId", () => {
    render(<PackageDownloadButton caseId="c-42" />);
    fireEvent.click(screen.getByRole("button", { name: /download package/i }));
    expect(downloadMutate).toHaveBeenCalledWith({ caseId: "c-42" });
  });

  it("opens signed URL in new tab on success", () => {
    let capturedOnSuccess: ((data: { url: string }) => void) | null = null;
    useDownloadMock.mockImplementation(
      (opts?: { onSuccess?: (d: { url: string }) => void }) => {
        capturedOnSuccess = opts?.onSuccess ?? null;
        return { mutate: downloadMutate, isPending: false };
      },
    );
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<PackageDownloadButton caseId="c-1" />);
    capturedOnSuccess?.({ url: "/pkg-signed-stub" });
    expect(openSpy).toHaveBeenCalledWith(
      "/pkg-signed-stub",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("renders error message via role=alert when mutation fails", () => {
    let capturedOnError: ((err: { message: string }) => void) | null = null;
    useDownloadMock.mockImplementation(
      (opts?: { onError?: (e: { message: string }) => void }) => {
        capturedOnError = opts?.onError ?? null;
        return { mutate: downloadMutate, isPending: false };
      },
    );
    render(<PackageDownloadButton caseId="c-1" />);
    // Wrap in act() so React flushes the setState the onError triggers.
    act(() => {
      capturedOnError?.({ message: "Approve at least one output" });
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /approve at least one output/i,
    );
  });

  it("disables button while pending", () => {
    useDownloadMock.mockReturnValue({
      mutate: downloadMutate,
      isPending: true,
    });
    render(<PackageDownloadButton caseId="c-1" />);
    expect(
      screen.getByRole("button", { name: /preparing pdf/i }),
    ).toBeDisabled();
  });
});
