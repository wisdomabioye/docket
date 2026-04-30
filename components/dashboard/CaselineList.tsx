import { Caseline, type CaselineProps } from "./Caseline";

/**
 * Stage 11 caseline list — header row + rows. Header columns mirror
 * the Caseline grid template so they line up across rows.
 *
 * Empty-state rendered when `items` is empty. Caller controls the
 * empty copy + CTA via `emptyState`.
 */
export type CaselineListProps = {
  items: ReadonlyArray<CaselineProps>;
  emptyState?: React.ReactNode;
};

export function CaselineList(
  props: CaselineListProps,
): React.ReactElement {
  if (props.items.length === 0) {
    return <>{props.emptyState ?? null}</>;
  }
  return (
    <div className="space-y-px">
      <div
        className="grid items-center gap-3 px-3 pb-2 text-[10px] uppercase tracking-wider"
        style={{
          color: "var(--ink-muted)",
          gridTemplateColumns:
            "32px minmax(160px, 1.2fr) minmax(80px, 0.6fr) minmax(140px, 1.2fr) minmax(140px, 1fr) 90px",
        }}
      >
        <span />
        <span>Beneficiary</span>
        <span>Visa</span>
        <span>Stage</span>
        <span>Next action</span>
        <span className="text-right">Updated</span>
      </div>
      {props.items.map((item) => (
        <Caseline key={item.caseId} {...item} />
      ))}
    </div>
  );
}
