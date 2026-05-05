import { CASELINE_GRID, Caseline, type CaselineProps } from "./Caseline";

/**
 * Stage 11 caseline list — header row + rows. Header is hidden below
 * `md` because rows collapse into stacked cards there; on `md+` the
 * header columns share the row's grid template so labels line up.
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
        className={`hidden items-center gap-3 px-3 pb-2 text-[10px] uppercase tracking-wider md:grid ${CASELINE_GRID}`}
        style={{ color: "var(--ink-muted)" }}
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
