// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { AuthShell } from "@/components/layout/AuthShell";

afterEach(cleanup);

describe("AuthShell", () => {
  it("renders the title + children", () => {
    render(
      <AuthShell title="Docket">
        <p>Body content</p>
      </AuthShell>,
    );
    expect(
      screen.getByRole("heading", { name: /docket/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("renders the eyebrow when supplied", () => {
    render(
      <AuthShell eyebrow="Sign in" title="Docket">
        <span />
      </AuthShell>,
    );
    expect(screen.getByText(/sign in/i)).toBeInTheDocument();
  });

  it("omits the eyebrow when not supplied", () => {
    render(
      <AuthShell title="Docket">
        <span />
      </AuthShell>,
    );
    // No "Sign in"-style eyebrow appears.
    expect(screen.queryByText(/^sign in$/i)).toBeNull();
  });

  it("renders the footer when supplied + skips it when not", () => {
    const { rerender } = render(
      <AuthShell title="Docket" footer={<span>Terms link</span>}>
        <span />
      </AuthShell>,
    );
    expect(screen.getByText("Terms link")).toBeInTheDocument();
    rerender(
      <AuthShell title="Docket">
        <span />
      </AuthShell>,
    );
    expect(screen.queryByText("Terms link")).toBeNull();
  });
});
