// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RequiredDocsCard } from "@/components/case/RequiredDocsCard";

afterEach(() => cleanup());

/**
 * Tag derivation is the substantive logic in this component:
 *   - `present === null`         → MANUAL pill
 *   - `present === false` + minCount > 1 → "<count> OF <minCount>" warning pill
 *   - `present === false` + criterion    → "CRIT N" info pill
 *   - `present === true`         → no tag
 */
describe("RequiredDocsCard", () => {
  it("renders EmptyState for unsupported visa", () => {
    render(
      <RequiredDocsCard
        visaType="O-1B"
        visaSupported={false}
        items={[]}
      />,
    );
    expect(
      screen.getByText(/Required-doc list for O-1B ships/i),
    ).toBeInTheDocument();
  });

  it("renders done / total in the header meta", () => {
    render(
      <RequiredDocsCard
        visaType="O-1A"
        visaSupported={true}
        items={[
          {
            key: "cv",
            label: "CV",
            criterion: null,
            count: 1,
            minCount: 1,
            present: true,
          },
          {
            key: "press",
            label: "Press",
            criterion: 3,
            count: 0,
            minCount: 1,
            present: false,
          },
        ]}
      />,
    );
    expect(screen.getByText(/^1 \/ 2$/)).toBeInTheDocument();
  });

  it("derives 'X OF Y' warning pill for partial multi-count rows", () => {
    render(
      <RequiredDocsCard
        visaType="O-1A"
        visaSupported={true}
        items={[
          {
            key: "rec_letters",
            label: "Recommendation letters (3+)",
            criterion: null,
            count: 2,
            minCount: 3,
            present: false,
          },
        ]}
      />,
    );
    expect(screen.getByText("2 OF 3")).toBeInTheDocument();
  });

  it("derives 'MANUAL' pill for unknown-status rows (no enum bucket)", () => {
    render(
      <RequiredDocsCard
        visaType="O-1A"
        visaSupported={true}
        items={[
          {
            key: "passport",
            label: "Passport bio page",
            criterion: null,
            count: 0,
            minCount: 1,
            present: null,
          },
        ]}
      />,
    );
    expect(screen.getByText("MANUAL")).toBeInTheDocument();
  });

  it("derives 'CRIT N' pill for missing rows linked to a criterion", () => {
    render(
      <RequiredDocsCard
        visaType="O-1A"
        visaSupported={true}
        items={[
          {
            key: "press",
            label: "Press / media",
            criterion: 3,
            count: 0,
            minCount: 1,
            present: false,
          },
        ]}
      />,
    );
    expect(screen.getByText("CRIT 3")).toBeInTheDocument();
  });

  it("renders no tag for fully-present singletons", () => {
    render(
      <RequiredDocsCard
        visaType="O-1A"
        visaSupported={true}
        items={[
          {
            key: "cv",
            label: "Beneficiary CV",
            criterion: null,
            count: 1,
            minCount: 1,
            present: true,
          },
        ]}
      />,
    );
    // No criterion pill and no warning pill should be present.
    expect(screen.queryByText(/MANUAL|CRIT|OF/i)).not.toBeInTheDocument();
  });
});
