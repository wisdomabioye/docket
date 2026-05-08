import "server-only";
import { Document } from "@react-pdf/renderer";
import type { OutputType } from "@/server/services/computer/types";
import { CoverPage } from "./cover";
import { ProsePage } from "./prose-page";
import { ExhibitIndexPage } from "./exhibit-index-page";

/**
 * Package document — the bundle the attorney downloads from
 * `/case/[id]/package`. Cover page first, then approved outputs in
 * the canonical filing order, exhibit-index appended last (USCIS
 * convention: exhibits are always at the back).
 *
 * Per-output PDFs reuse the same building blocks: a single `<Document>`
 * with the cover + the relevant body page + nothing else.
 */

/** Canonical document order in a filing package. Anything not listed
 *  here ends up after the listed types in alphabetic fallback order
 *  (handled by the sort in `compileFullPackagePdf`). */
const PACKAGE_ORDER: ReadonlyArray<OutputType> = [
  "petition_letter",
  "personal_statement",
  "recommendation_letter_template",
  "criteria_analysis",
  // `evidence_plan` is internal scaffolding (see `INTERNAL_OUTPUT_TYPES`
  // in `lib/output-types.ts`) and never appears in the package — it's
  // intentionally absent from this canonical-order list.
  "exhibit_index",
];

export function packageOrderRank(outputType: OutputType): number {
  const idx = PACKAGE_ORDER.indexOf(outputType);
  // Unknown / future types sort after the canonical set but stay
  // deterministic via their string ordering at the call site.
  return idx === -1 ? PACKAGE_ORDER.length : idx;
}

/**
 * Stable identifier for a package row. Used as the persisted key in
 * `cases.package_order`, the DnD id in `PackageAssemblyCard`, and the
 * lookup key when the PDF service applies the saved order. Keep all
 * three call sites importing THIS function — the formatting must stay
 * byte-identical across them or the saved order silently misses rows.
 */
export function packageKeyFor(args: {
  outputType: OutputType;
  subgroupKey: string | null;
}): string {
  return args.subgroupKey
    ? `${args.outputType}:${args.subgroupKey}`
    : args.outputType;
}

/** Single output rendered as a standalone PDF document (cover +
 *  one body page). Used by `output.downloadPdf`. */
export type PerOutputPdfProps = {
  cover: React.ComponentProps<typeof CoverPage>;
  /** The body page element (chosen by output type at the call site —
   *  prose vs. exhibit-index). Passing the element instead of the type
   *  + props keeps this component generic and lets the caller make the
   *  type decision once with full type-narrowing. */
  body: React.ReactElement;
};

export function PerOutputPdfDocument(props: PerOutputPdfProps) {
  return (
    <Document
      title={props.cover.title}
      author={props.cover.attorneyName}
      subject={`${props.cover.visaType} — ${props.cover.beneficiaryName}`}
    >
      <CoverPage {...props.cover} />
      {props.body}
    </Document>
  );
}

/** Body element for one output — built by the caller and inserted into
 *  the package or per-output document. The discriminator lets the
 *  caller pick the right body type without a runtime `if`. */
export type OutputBodyDescriptor =
  | {
      kind: "prose";
      runningHeading: string;
      subtitle?: string;
      content: string;
      /** Optional diagonal watermark for unsigned-letter pages. */
      watermark?: string;
    }
  | {
      kind: "exhibit-index";
      beneficiaryName: string;
      visaType: string;
      content: string;
      exhibitCount: number | null;
    };

export function renderOutputBody(
  desc: OutputBodyDescriptor,
  key: string,
): React.ReactElement {
  if (desc.kind === "prose") {
    const proseProps: React.ComponentProps<typeof ProsePage> = {
      runningHeading: desc.runningHeading,
      content: desc.content,
      ...(desc.subtitle ? { subtitle: desc.subtitle } : {}),
      ...(desc.watermark ? { watermark: desc.watermark } : {}),
    };
    return <ProsePage key={key} {...proseProps} />;
  }
  return (
    <ExhibitIndexPage
      key={key}
      beneficiaryName={desc.beneficiaryName}
      visaType={desc.visaType}
      content={desc.content}
      exhibitCount={desc.exhibitCount}
    />
  );
}

/** Full package — cover + every approved output's body in canonical
 *  order. */
export type PackagePdfProps = {
  cover: React.ComponentProps<typeof CoverPage>;
  /** Already-sorted descriptors. Caller ranks via `packageOrderRank`. */
  bodies: ReadonlyArray<{ key: string; body: OutputBodyDescriptor }>;
};

export function PackagePdfDocument(props: PackagePdfProps) {
  return (
    <Document
      title={props.cover.title}
      author={props.cover.attorneyName}
      subject={`${props.cover.visaType} — ${props.cover.beneficiaryName}`}
    >
      <CoverPage {...props.cover} />
      {props.bodies.map(({ key, body }) => renderOutputBody(body, key))}
    </Document>
  );
}
