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
const useSuspendMock = vi.hoisted(() =>
  vi.fn(() => ({ mutate: mutateMock, isPending: false })),
);
const routerRefreshMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    admin: {
      suspendAttorney: { useMutation: useSuspendMock },
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

import { SuspendButton } from "@/app/(admin)/admin/attorneys/SuspendButton";

afterEach(() => {
  cleanup();
  mutateMock.mockReset();
  useSuspendMock.mockReset();
  useSuspendMock.mockReturnValue({ mutate: mutateMock, isPending: false });
  routerRefreshMock.mockReset();
});

describe("SuspendButton — collapsed state", () => {
  it("renders the Suspend trigger button initially", () => {
    render(<SuspendButton userId="u-1" />);
    expect(
      screen.getByRole("button", { name: /^suspend$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /confirm/i }),
    ).not.toBeInTheDocument();
  });

  it("clicking Suspend reveals the textarea + Confirm/Cancel", () => {
    render(<SuspendButton userId="u-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^suspend$/i }));
    expect(
      screen.getByRole("textbox", { name: /suspension reason/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^confirm$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^cancel$/i }),
    ).toBeInTheDocument();
  });
});

describe("SuspendButton — confirm gate", () => {
  it("Confirm button is DISABLED when reason is empty", () => {
    render(<SuspendButton userId="u-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^suspend$/i }));
    expect(
      screen.getByRole("button", { name: /^confirm$/i }),
    ).toBeDisabled();
  });

  it("Confirm button stays DISABLED for whitespace-only reason", () => {
    render(<SuspendButton userId="u-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^suspend$/i }));
    fireEvent.change(
      screen.getByRole("textbox", { name: /suspension reason/i }),
      { target: { value: "   \n   " } },
    );
    expect(
      screen.getByRole("button", { name: /^confirm$/i }),
    ).toBeDisabled();
  });

  it("Confirm fires the mutation with TRIMMED reason", () => {
    render(<SuspendButton userId="u-9" />);
    fireEvent.click(screen.getByRole("button", { name: /^suspend$/i }));
    fireEvent.change(
      screen.getByRole("textbox", { name: /suspension reason/i }),
      { target: { value: "  Bar standing revoked  " } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    expect(mutateMock).toHaveBeenCalledWith(
      { userId: "u-9", reason: "Bar standing revoked" },
      expect.any(Object),
    );
  });

  it("textarea caps at 500 chars (Zod input cap)", () => {
    render(<SuspendButton userId="u-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^suspend$/i }));
    const textarea = screen.getByRole("textbox", {
      name: /suspension reason/i,
    }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "x".repeat(700) } });
    expect(textarea.value.length).toBe(500);
  });
});

describe("SuspendButton — Cancel + state transitions", () => {
  it("Cancel collapses the panel back to the trigger", () => {
    render(<SuspendButton userId="u-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^suspend$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(
      screen.getByRole("button", { name: /^suspend$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^confirm$/i }),
    ).not.toBeInTheDocument();
  });

  it("Confirm disables itself + Cancel + textarea while in flight", () => {
    useSuspendMock.mockReturnValue({ mutate: mutateMock, isPending: true });
    render(<SuspendButton userId="u-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^suspend$/i }));
    fireEvent.change(
      screen.getByRole("textbox", { name: /suspension reason/i }),
      { target: { value: "reason" } },
    );
    expect(
      screen.getByRole("button", { name: /^cancel$/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: /suspension reason/i }),
    ).toBeDisabled();
  });
});

describe("SuspendButton — success flow", () => {
  it("calls router.refresh() after successful suspend + collapses panel", () => {
    const captured: {
      onSuccess: (() => void) | null;
    } = { onSuccess: null };
    mutateMock.mockImplementation(
      (
        _input: { userId: string; reason: string },
        opts?: { onSuccess?: () => void },
      ) => {
        captured.onSuccess = opts?.onSuccess ?? null;
      },
    );
    render(<SuspendButton userId="u-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^suspend$/i }));
    fireEvent.change(
      screen.getByRole("textbox", { name: /suspension reason/i }),
      { target: { value: "Bar revoked" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    act(() => {
      captured.onSuccess?.();
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    // Panel collapsed back to the trigger.
    expect(
      screen.getByRole("button", { name: /^suspend$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^confirm$/i }),
    ).not.toBeInTheDocument();
  });
});

describe("SuspendButton — error display", () => {
  it("renders the server's error message via role=alert when mutation fails", () => {
    const captured: {
      onError: ((err: { message: string }) => void) | null;
    } = { onError: null };
    mutateMock.mockImplementation(
      (
        _input: { userId: string; reason: string },
        opts?: { onError?: (e: { message: string }) => void },
      ) => {
        captured.onError = opts?.onError ?? null;
      },
    );
    render(<SuspendButton userId="u-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^suspend$/i }));
    fireEvent.change(
      screen.getByRole("textbox", { name: /suspension reason/i }),
      { target: { value: "reason" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    act(() => {
      captured.onError?.({ message: "Already suspended" });
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/already suspended/i);
  });
});
