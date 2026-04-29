// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * `VersionHistory` queries `output.listVersions` and renders rows
 * with a per-row Restore button (skipped on the current row).
 *
 * Branches covered:
 *   - Loading state.
 *   - Error state.
 *   - Empty list.
 *   - Restore button hidden on `currentVersionId` row.
 *   - Click Restore → fires mutation with the right fromVersionId.
 */

type ListVersionsRow = {
  id: string;
  outputVersion: number;
  isCurrent: boolean;
  parentId: string | null;
  author: "computer" | "attorney" | "system";
  attorneyApproved: boolean;
  createdAt: Date;
  costCents: bigint | null;
};

const restoreMutate = vi.hoisted(() => vi.fn());
const useListVersionsMock = vi.hoisted(() =>
  vi.fn(
    (): {
      data: ListVersionsRow[] | undefined;
      isLoading: boolean;
      isError: boolean;
    } => ({
      data: [] as ListVersionsRow[],
      isLoading: false,
      isError: false,
    }),
  ),
);
const useRestoreMock = vi.hoisted(() =>
  vi.fn(() => ({ mutate: restoreMutate, isPending: false })),
);
const utilsMock = vi.hoisted(() => ({
  output: {
    list: { invalidate: vi.fn(async () => undefined) },
    listVersions: { invalidate: vi.fn(async () => undefined) },
  },
}));

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    useUtils: () => utilsMock,
    output: {
      listVersions: { useQuery: useListVersionsMock },
      restoreVersion: { useMutation: useRestoreMock },
    },
  },
}));

import { VersionHistory } from "@/components/output/VersionHistory";

afterEach(() => {
  cleanup();
  restoreMutate.mockReset();
  useListVersionsMock.mockReset();
  useRestoreMock.mockReset();
  useListVersionsMock.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
  });
  useRestoreMock.mockReturnValue({ mutate: restoreMutate, isPending: false });
});

const baseProps = {
  caseId: "c-1",
  outputType: "personal_statement" as const,
  subgroupKey: null as string | null,
  currentVersionId: "v-current",
};

describe("VersionHistory", () => {
  it("renders loading state", () => {
    useListVersionsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    render(<VersionHistory {...baseProps} />);
    expect(screen.getByText(/loading versions/i)).toBeInTheDocument();
  });

  it("renders error state", () => {
    useListVersionsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    render(<VersionHistory {...baseProps} />);
    expect(
      screen.getByText(/couldn['’]t load version history/i),
    ).toBeInTheDocument();
  });

  it("renders empty-list message", () => {
    useListVersionsMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    render(<VersionHistory {...baseProps} />);
    expect(screen.getByText(/no versions yet/i)).toBeInTheDocument();
  });

  it("renders rows; Restore is hidden for the current row", () => {
    useListVersionsMock.mockReturnValue({
      data: [
        {
          id: "v-current",
          outputVersion: 2,
          isCurrent: true,
          parentId: "v-1",
          author: "attorney",
          attorneyApproved: false,
          createdAt: new Date(),
          costCents: null,
        },
        {
          id: "v-1",
          outputVersion: 1,
          isCurrent: false,
          parentId: null,
          author: "computer",
          attorneyApproved: true,
          createdAt: new Date(),
          costCents: null,
        },
      ] satisfies ListVersionsRow[],
      isLoading: false,
      isError: false,
    });
    render(<VersionHistory {...baseProps} />);
    // v2 is current → no Restore button
    // v1 is non-current → Restore button present
    const buttons = screen.getAllByRole("button", { name: /restore/i });
    expect(buttons).toHaveLength(1);
  });

  it("fires restoreMutation with fromVersionId when Restore clicked", () => {
    useListVersionsMock.mockReturnValue({
      data: [
        {
          id: "v-current",
          outputVersion: 2,
          isCurrent: true,
          parentId: null,
          author: "computer",
          attorneyApproved: false,
          createdAt: new Date(),
          costCents: null,
        },
        {
          id: "v-old",
          outputVersion: 1,
          isCurrent: false,
          parentId: null,
          author: "computer",
          attorneyApproved: false,
          createdAt: new Date(),
          costCents: null,
        },
      ] satisfies ListVersionsRow[],
      isLoading: false,
      isError: false,
    });
    render(<VersionHistory {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /restore/i }));
    expect(restoreMutate).toHaveBeenCalledWith({ fromVersionId: "v-old" });
  });

  it("forwards subgroupKey to listVersions when provided", () => {
    useListVersionsMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    render(<VersionHistory {...baseProps} subgroupKey="rec-a" />);
    expect(useListVersionsMock).toHaveBeenCalledWith({
      caseId: "c-1",
      outputType: "personal_statement",
      subgroupKey: "rec-a",
    });
  });

  it("OMITS subgroupKey from query when null (matches Zod optional)", () => {
    useListVersionsMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    render(<VersionHistory {...baseProps} subgroupKey={null} />);
    expect(useListVersionsMock).toHaveBeenCalledWith({
      caseId: "c-1",
      outputType: "personal_statement",
    });
  });
});
