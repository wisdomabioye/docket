// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { BundleStats } from "@/components/output/BundleStats";

afterEach(cleanup);

describe("BundleStats", () => {
  it("renders each stat's value and label", () => {
    render(
      <BundleStats
        items={[
          { value: 7, label: "Outputs" },
          { value: 5, label: "Approved" },
          { value: "6/8", label: "Criteria" },
        ]}
      />,
    );
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Outputs")).toBeInTheDocument();
    expect(screen.getByText("6/8")).toBeInTheDocument();
    expect(screen.getByText("Criteria")).toBeInTheDocument();
  });

  it("renders an empty cluster (no stat children) for no items", () => {
    const { container } = render(<BundleStats items={[]} />);
    const cluster = container.querySelector('[data-component="bundle-stats"]');
    expect(cluster).toBeInTheDocument();
    expect(cluster?.children.length).toBe(0);
  });
});
