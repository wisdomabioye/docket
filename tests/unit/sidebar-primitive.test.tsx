// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

import { Sidebar } from "@/components/layout/Sidebar";

afterEach(cleanup);

const SECTIONS = [
  {
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" as const },
    ],
  },
  {
    label: "Pipeline",
    items: [
      {
        label: "Intake",
        href: "/dashboard?stage=intake",
        icon: "clipboard-list" as const,
        count: 3,
      },
      {
        label: "Documents",
        href: "/dashboard?stage=documents",
        icon: "file-text" as const,
        count: 0,
      },
    ],
  },
];

describe("Sidebar primitive", () => {
  it("renders the brand slot + section heading + items", () => {
    render(
      <Sidebar
        ariaLabel="Test nav"
        brand={<span>BrandHere</span>}
        sections={SECTIONS}
      />,
    );
    expect(screen.getAllByText("BrandHere").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pipeline").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Intake").length).toBeGreaterThan(0);
  });

  it("shows count badges for items with count > 0", () => {
    render(
      <Sidebar
        ariaLabel="Test nav"
        brand={<span>B</span>}
        sections={SECTIONS}
      />,
    );
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    // count=0 items must not render their badge.
    expect(screen.queryByText("0")).toBeNull();
  });

  it("highlights the item matching the current pathname", () => {
    render(
      <Sidebar
        ariaLabel="Test nav"
        brand={<span>B</span>}
        sections={SECTIONS}
      />,
    );
    const dashboardLink = screen.getAllByRole("link", { name: /dashboard/i })[0]!;
    // Active state is signalled via background-color class — assert class attribute.
    expect(dashboardLink.className).toMatch(/bg-/);
  });

  it("renders the footer slot when provided", () => {
    render(
      <Sidebar
        ariaLabel="Test nav"
        brand={<span>B</span>}
        sections={[]}
        footer={<span>UserCardHere</span>}
      />,
    );
    expect(screen.getAllByText("UserCardHere").length).toBeGreaterThan(0);
  });
});
