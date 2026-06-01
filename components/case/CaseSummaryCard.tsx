import { Card } from "@/components/ui";
import { formatMb } from "@/lib/utils";

/**
 * Right-rail "Case summary" KV card on the overview (Stage 13 / #72).
 * Mockup `case-overview.html` (l. 207-220). Every row is data-backed —
 * optional rows (country, residence, target filing) are omitted when the
 * field is unset rather than shown empty. The mockup's "Current status:
 * F-1 · OPT" (beneficiary immigration status) has no field in our schema,
 * so it's replaced by "Residence" (real `currentCity`/`currentCountry`).
 *
 * Pure presentational — the overview RSC gathers the values (visa + the
 * parsed beneficiary blob + recommender/doc/output counts) and passes
 * them in. No fabrication.
 */

export type CaseSummaryCardProps = {
  visaType: string;
  /** Field of endeavour (e.g. "Sciences"), shown after the visa. */
  field?: string;
  nationality?: string;
  residence?: string;
  /** ISO `yyyy-mm-dd`. */
  targetFilingDate?: string;
  recommenderCount: number;
  documentCount: number;
  usedBytes: bigint | number;
  outputsApproved: number;
  outputsTotal: number;
};

export function CaseSummaryCard(
  props: CaseSummaryCardProps,
): React.ReactElement {
  return (
    <Card title="Case summary">
      <dl className="space-y-0">
        <Row k="Visa">
          {props.visaType}
          {props.field ? ` · ${props.field}` : ""}
        </Row>
        {props.nationality ? (
          <Row k="Country of birth">{props.nationality}</Row>
        ) : null}
        {props.residence ? <Row k="Residence">{props.residence}</Row> : null}
        {props.targetFilingDate ? (
          <Row k="Target filing" mono>
            {props.targetFilingDate}
          </Row>
        ) : null}
        <Row k="Recommenders">
          {props.recommenderCount} confirmed
        </Row>
        <Row k="Documents">
          {props.documentCount} · {formatMb(props.usedBytes)} MB
        </Row>
        <Row k="Outputs">
          {props.outputsTotal > 0
            ? `${props.outputsApproved} / ${props.outputsTotal} ready`
            : "None yet"}
        </Row>
      </dl>
    </Card>
  );
}

function Row(props: {
  k: string;
  mono?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="flex items-baseline justify-between gap-4 border-b py-1.5 text-[12.5px] last:border-0"
      style={{ borderColor: "var(--border, rgba(0,0,0,0.06))" }}
    >
      <dt style={{ color: "var(--ink-muted)" }}>{props.k}</dt>
      <dd
        className={props.mono ? "mono" : undefined}
        style={{ color: "var(--ink)" }}
      >
        {props.children}
      </dd>
    </div>
  );
}
