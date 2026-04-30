// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { PendingApprovalCard } from "@/components/onboarding/PendingApprovalCard";

afterEach(cleanup);

describe("PendingApprovalCard", () => {
  it("renders the eyebrow + serif headline + section role", () => {
    render(<PendingApprovalCard />);
    const section = screen.getByRole("region", {
      name: /account pending approval/i,
    });
    expect(section).toBeInTheDocument();
    expect(
      screen.getByText(/your docket account is pending approval/i),
    ).toBeInTheDocument();
  });

  it("includes the email when provided", () => {
    render(<PendingApprovalCard email="attorney@example.com" />);
    expect(screen.getByText(/attorney@example.com/)).toBeInTheDocument();
  });

  it("omits the 'we'll email you at' suffix when email is null/undefined", () => {
    render(<PendingApprovalCard />);
    expect(screen.queryByText(/at\s+attorney@example/)).toBeNull();
  });

  it("renders a 'Submitted' line when submittedAt is given", () => {
    render(
      <PendingApprovalCard submittedAt={new Date("2026-04-29T12:00:00Z")} />,
    );
    expect(screen.getByText(/submitted/i)).toBeInTheDocument();
  });

  it("omits the submitted line when submittedAt is null/undefined", () => {
    render(<PendingApprovalCard />);
    expect(screen.queryByText(/^submitted/i)).toBeNull();
  });

  it("renders an 'Edit application' link to the onboarding route", () => {
    render(<PendingApprovalCard />);
    const link = screen.getByRole("link", { name: /edit application/i });
    expect(link).toHaveAttribute("href", "/onboarding");
  });
});
