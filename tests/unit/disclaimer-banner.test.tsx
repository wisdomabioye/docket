import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DisclaimerBanner } from "@/components/output/DisclaimerBanner";
import { DISCLAIMER } from "@/lib/computer/disclaimer";

afterEach(() => cleanup());

/**
 * The disclaimer banner is mandatory on every output detail page +
 * package page (spec §17 + Stage 08 lock). Tests guarantee it
 * actually mounts the canonical DISCLAIMER constant — drift here
 * would be a compliance gap.
 */
describe("DisclaimerBanner", () => {
  it("renders the canonical DISCLAIMER constant verbatim", () => {
    render(<DisclaimerBanner />);
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });

  it("calls itself out as an AI disclaimer (a11y)", () => {
    render(<DisclaimerBanner />);
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("aria-label", "AI disclaimer");
  });

  it("includes the 'AI-generated draft' lede so attorneys see it before the body", () => {
    render(<DisclaimerBanner />);
    expect(screen.getByText(/AI-generated draft\./i)).toBeInTheDocument();
  });
});
