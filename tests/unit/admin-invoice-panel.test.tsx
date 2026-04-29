// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const previewRefetchMock = vi.hoisted(() => vi.fn());
const generateMutateMock = vi.hoisted(() => vi.fn());
const useEligibleMock = vi.hoisted(() =>
  vi.fn(() => ({
    data: undefined as unknown,
    refetch: previewRefetchMock,
    isFetching: false,
  })),
);
const useGenerateMock = vi.hoisted(() =>
  vi.fn(() => ({ mutate: generateMutateMock, isPending: false })),
);
const routerRefreshMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    revenue: {
      eligibleCasesForPeriod: { useQuery: useEligibleMock },
      adminGenerateInvoice: { useMutation: useGenerateMock },
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

import { AdminInvoicePanel } from "@/components/revenue/AdminInvoicePanel";

const ATTORNEYS = [
  { userId: "u-1", label: "Alice · alice@law.test" },
  { userId: "u-2", label: "Bob · bob@law.test" },
];

afterEach(() => {
  cleanup();
  previewRefetchMock.mockReset();
  generateMutateMock.mockReset();
  useEligibleMock.mockReset();
  useEligibleMock.mockReturnValue({
    data: undefined,
    refetch: previewRefetchMock,
    isFetching: false,
  });
  useGenerateMock.mockReset();
  useGenerateMock.mockReturnValue({
    mutate: generateMutateMock,
    isPending: false,
  });
  routerRefreshMock.mockReset();
});

describe("AdminInvoicePanel — empty roster", () => {
  it("renders an inline message + no form when there are no attorneys", () => {
    render(<AdminInvoicePanel attorneys={[]} />);
    expect(screen.getByText(/no attorneys with filed cases/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /preview/i })).toBeNull();
  });
});

describe("AdminInvoicePanel — initial state", () => {
  it("renders attorney dropdown + period inputs + Preview/Generate", () => {
    render(<AdminInvoicePanel attorneys={ATTORNEYS} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate invoice/i })).toBeInTheDocument();
  });

  it("Generate button starts DISABLED (no preview yet)", () => {
    render(<AdminInvoicePanel attorneys={ATTORNEYS} />);
    expect(
      screen.getByRole("button", { name: /generate invoice/i }),
    ).toBeDisabled();
  });
});

describe("AdminInvoicePanel — preview flow", () => {
  it("clicking Preview triggers the eligible-cases query refetch", () => {
    render(<AdminInvoicePanel attorneys={ATTORNEYS} />);
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(previewRefetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders 'no eligible cases' message after Preview returns empty", () => {
    useEligibleMock.mockReturnValue({
      data: { items: [], totalDocketCents: 0 },
      refetch: previewRefetchMock,
      isFetching: false,
    });
    render(<AdminInvoicePanel attorneys={ATTORNEYS} />);
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(screen.getByText(/no eligible cases/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /generate invoice/i }),
    ).toBeDisabled();
  });

  it("renders eligible cases + total + ENABLES Generate after Preview", () => {
    useEligibleMock.mockReturnValue({
      data: {
        items: [
          {
            id: "c-1",
            visaType: "O-1A",
            beneficiaryFullName: "Maria Gonzalez",
            caseFeeCents: "600000",
            docketShareCents: "90000",
            attorneyShareCents: "510000",
            filedAt: new Date().toISOString(),
          },
        ],
        totalDocketCents: 90_000,
      },
      refetch: previewRefetchMock,
      isFetching: false,
    });
    render(<AdminInvoicePanel attorneys={ATTORNEYS} />);
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(screen.getByText(/1 eligible case/i)).toBeInTheDocument();
    expect(screen.getByText("O-1A")).toBeInTheDocument();
    expect(screen.getByText("Maria Gonzalez")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /generate invoice/i }),
    ).not.toBeDisabled();
  });

  it("hides preview + disables Generate when attorney changes after Preview (stale guard)", () => {
    useEligibleMock.mockReturnValue({
      data: {
        items: [
          {
            id: "c-1",
            visaType: "O-1A",
            beneficiaryFullName: "Maria Gonzalez",
            caseFeeCents: "600000",
            docketShareCents: "90000",
            attorneyShareCents: "510000",
            filedAt: new Date().toISOString(),
          },
        ],
        totalDocketCents: 90_000,
      },
      refetch: previewRefetchMock,
      isFetching: false,
    });
    render(<AdminInvoicePanel attorneys={ATTORNEYS} />);
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(screen.getByText("Maria Gonzalez")).toBeInTheDocument();
    // Switch attorney → preview must hide and Generate disable.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "u-2" } });
    expect(screen.queryByText("Maria Gonzalez")).toBeNull();
    expect(
      screen.getByRole("button", { name: /generate invoice/i }),
    ).toBeDisabled();
  });
});

describe("AdminInvoicePanel — generate", () => {
  it("Generate is disabled until Preview is clicked (no stale-data clicks)", () => {
    render(<AdminInvoicePanel attorneys={ATTORNEYS} />);
    expect(
      screen.getByRole("button", { name: /generate invoice/i }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /generate invoice/i }));
    expect(generateMutateMock).not.toHaveBeenCalled();
  });

  it("clicking Generate after a fresh non-empty Preview fires the mutation", () => {
    useEligibleMock.mockReturnValue({
      data: {
        items: [
          {
            id: "c-1",
            visaType: "O-1A",
            beneficiaryFullName: "X Y",
            caseFeeCents: "1",
            docketShareCents: "0",
            attorneyShareCents: "1",
            filedAt: null,
          },
        ],
        totalDocketCents: 0,
      },
      refetch: previewRefetchMock,
      isFetching: false,
    });
    render(<AdminInvoicePanel attorneys={ATTORNEYS} />);
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /generate invoice/i }));
    expect(generateMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attorneyUserId: "u-1",
        periodYear: expect.any(Number),
        periodMonth: expect.any(Number),
      }),
    );
  });
});
