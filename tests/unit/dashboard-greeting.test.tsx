// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import {
  GreetingBand,
  greetingFor,
} from "@/components/dashboard/GreetingBand";

afterEach(cleanup);

describe("greetingFor", () => {
  it("returns 'Good morning' before noon", () => {
    expect(greetingFor(new Date("2026-04-30T08:00:00"))).toBe("Good morning");
  });
  it("returns 'Good afternoon' between noon and 18", () => {
    expect(greetingFor(new Date("2026-04-30T13:00:00"))).toBe("Good afternoon");
  });
  it("returns 'Good evening' at 18 and after", () => {
    expect(greetingFor(new Date("2026-04-30T19:00:00"))).toBe("Good evening");
  });
});

describe("GreetingBand", () => {
  it("renders the override greeting + name", () => {
    render(
      <GreetingBand greetingOverride="Good morning" name="Alice" />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: /good morning, alice/i }),
    ).toBeInTheDocument();
  });

  it("omits the stat sentence when stats is undefined", () => {
    render(<GreetingBand greetingOverride="Hi" name="Alice" />);
    expect(screen.queryByText(/you have/i)).toBeNull();
  });

  it("renders the stat sentence when stats has items", () => {
    render(
      <GreetingBand
        greetingOverride="Hi"
        name="Alice"
        stats={[{ label: "3 drafts awaiting review" }]}
      />,
    );
    expect(
      screen.getByText(/you have/i),
    ).toHaveTextContent(/you have 3 drafts awaiting review/i);
  });

  it("renders the actions slot", () => {
    render(
      <GreetingBand
        greetingOverride="Hi"
        name="Alice"
        actions={<button type="button">+ New case</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: /\+ new case/i }),
    ).toBeInTheDocument();
  });
});
