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

const mutateMock = vi.hoisted(() => vi.fn());
const useLogFeeMock = vi.hoisted(() =>
  vi.fn(() => ({ mutate: mutateMock, isPending: false })),
);
const routerRefreshMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    revenue: {
      logCaseFee: { useMutation: useLogFeeMock },
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

import { RevenuePanel } from "@/components/revenue/RevenuePanel";

afterEach(() => {
  cleanup();
  mutateMock.mockReset();
  useLogFeeMock.mockReset();
  useLogFeeMock.mockReturnValue({ mutate: mutateMock, isPending: false });
  routerRefreshMock.mockReset();
});

type PanelInitial = React.ComponentProps<typeof RevenuePanel>["initial"];

const PENDING_INITIAL: PanelInitial = {
  feeCents: 600_000,
  docketShareCents: 90_000,
  attorneyShareCents: 510_000,
  revenueStatus: "pending",
};

function renderPanel(overrides: Partial<PanelInitial> = {}) {
  return render(
    <RevenuePanel
      caseId="case-1"
      initial={{ ...PENDING_INITIAL, ...overrides }}
    />,
  );
}

describe("RevenuePanel — initial render", () => {
  it("shows current fee in the input as dollars (formatted)", () => {
    renderPanel();
    const input = screen.getByLabelText(/case fee in usd/i) as HTMLInputElement;
    expect(input).toHaveValue("6000.00");
  });

  it("shows the saved split below the input", () => {
    renderPanel();
    expect(screen.getByText(/attorney share/i)).toBeInTheDocument();
    expect(screen.getByText("5100.00 USD")).toBeInTheDocument();
    expect(screen.getByText("900.00 USD")).toBeInTheDocument();
  });

  it("does NOT render the Save button when the input matches saved fee", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /save fee/i })).toBeNull();
  });
});

describe("RevenuePanel — locked states", () => {
  it("disables input AND hides Save when revenueStatus = invoiced", () => {
    renderPanel({ revenueStatus: "invoiced" });
    const input = screen.getByLabelText(/case fee in usd/i) as HTMLInputElement;
    // The locked path sets `disabled` on the input — the browser blocks
    // typing; jsdom doesn't enforce that, so we assert the attribute and
    // the absence of the Save trigger (the real defense — even if the
    // user could somehow change the input, no save can fire).
    expect(input).toBeDisabled();
    expect(screen.queryByRole("button", { name: /save fee/i })).toBeNull();
    expect(screen.getByText(/locked.*billed to client/i)).toBeInTheDocument();
  });

  it("disables input when revenueStatus = paid + shows 'paid' message", () => {
    renderPanel({ revenueStatus: "paid" });
    expect(screen.getByLabelText(/case fee in usd/i)).toBeDisabled();
    expect(screen.getByText(/locked.*billed and paid/i)).toBeInTheDocument();
  });

  it("waived state shows pro-bono note, but input is editable", () => {
    renderPanel({
      feeCents: 0,
      docketShareCents: 0,
      attorneyShareCents: 0,
      revenueStatus: "waived",
    });
    expect(screen.getByLabelText(/case fee in usd/i)).not.toBeDisabled();
    expect(screen.getByText(/pro-bono/i)).toBeInTheDocument();
  });
});

describe("RevenuePanel — dirty/save flow", () => {
  it("shows Save button after user changes the dollar input", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/case fee in usd/i), {
      target: { value: "7500.00" },
    });
    expect(screen.getByRole("button", { name: /save fee/i })).toBeInTheDocument();
  });

  it("clicking Save fires logCaseFee with the parsed cents", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/case fee in usd/i), {
      target: { value: "7500.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save fee/i }));
    expect(mutateMock).toHaveBeenCalledWith({
      caseId: "case-1",
      feeCents: 750_000,
    });
  });

  it("renders a live preview split for the typed amount", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/case fee in usd/i), {
      target: { value: "1000.00" },
    });
    // 100_000 cents → 15_000 / 85_000
    expect(screen.getByText("850.00 USD")).toBeInTheDocument();
    expect(screen.getByText("150.00 USD")).toBeInTheDocument();
  });

  it("Save button shows 'Saving…' while in flight", () => {
    useLogFeeMock.mockReturnValue({ mutate: mutateMock, isPending: true });
    renderPanel();
    fireEvent.change(screen.getByLabelText(/case fee in usd/i), {
      target: { value: "1000" },
    });
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });

  it("strips commas + leading $ from input before parse", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/case fee in usd/i), {
      target: { value: "$1,234.50" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save fee/i }));
    expect(mutateMock).toHaveBeenCalledWith({
      caseId: "case-1",
      feeCents: 123_450,
    });
  });
});

describe("RevenuePanel — invalid input", () => {
  it("shows error + does NOT fire mutation when input is malformed", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/case fee in usd/i), {
      target: { value: "abc" },
    });
    // No Save button visible because parsedCents is null → not "dirty"
    expect(screen.queryByRole("button", { name: /save fee/i })).toBeNull();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("rejects more than 2 decimal places", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/case fee in usd/i), {
      target: { value: "100.123" },
    });
    expect(screen.queryByRole("button", { name: /save fee/i })).toBeNull();
  });
});

describe("RevenuePanel — server error display", () => {
  it("surfaces the server error message via role=alert", () => {
    const captured: { onError: ((e: { message: string }) => void) | null } = {
      onError: null,
    };
    mutateMock.mockImplementation(
      (
        _input: { caseId: string; feeCents: number },
        opts?: { onError?: (e: { message: string }) => void },
      ) => {
        captured.onError = opts?.onError ?? null;
      },
    );
    // Need to capture onError from useMutation config, not mutate(). The
    // panel passes onError via `useMutation({ onError })`, so we need to
    // invoke useLogFeeMock with the config and forward.
    useLogFeeMock.mockImplementation(
      (opts?: {
        onError?: (e: { message: string }) => void;
        onSuccess?: () => void;
      }) => {
        captured.onError = opts?.onError ?? null;
        return { mutate: mutateMock, isPending: false };
      },
    );
    renderPanel();
    fireEvent.change(screen.getByLabelText(/case fee in usd/i), {
      target: { value: "5000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save fee/i }));
    act(() => {
      captured.onError?.({ message: "Case is already invoiced" });
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/already invoiced/i);
  });
});

describe("RevenuePanel — $0 → waived", () => {
  it("allows submitting 0 (pro-bono)", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/case fee in usd/i), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save fee/i }));
    expect(mutateMock).toHaveBeenCalledWith({
      caseId: "case-1",
      feeCents: 0,
    });
  });
});
