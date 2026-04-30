// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { FormField } from "@/components/form/FormField";

afterEach(cleanup);

describe("FormField", () => {
  it("associates the label with the inner control via htmlFor/id", () => {
    render(
      <FormField id="bar-num" label="Bar number">
        <input id="bar-num" />
      </FormField>,
    );
    const input = screen.getByLabelText(/bar number/i);
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe("INPUT");
  });

  it("renders a hint when provided", () => {
    render(
      <FormField id="x" label="Field" hint="Helper text here">
        <input id="x" />
      </FormField>,
    );
    expect(screen.getByText("Helper text here")).toBeInTheDocument();
  });

  it("renders an alert when error is set + suppresses the hint", () => {
    render(
      <FormField id="x" label="Field" hint="ignored when error" error="Boom">
        <input id="x" />
      </FormField>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Boom");
    expect(screen.queryByText("ignored when error")).toBeNull();
  });

  it("appends an asterisk indicator when required", () => {
    render(
      <FormField id="x" label="Field" required>
        <input id="x" />
      </FormField>,
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });
});
