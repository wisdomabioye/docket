import Link from "next/link";
import { APP_ROUTES } from "@/config";
import { shortCaseId } from "@/lib/case-id";

/**
 * Stage 11 dashboard caseline row — responsive layout.
 *
 *   - `md+`  → 6-column grid mirroring `dashboard.html .caseline`
 *              (avatar / beneficiary / visa / stage / next action / updated).
 *   - below  → stacked card: avatar + name on row 1, visa + updated on
 *              row 2, stage bar on row 3, next action on row 4.
 *
 * Grid template lives in one place (`CASELINE_GRID`) so the row and
 * the list header stay aligned without two copies drifting.
 */
export type CaselineProps = {
  caseId: string;
  beneficiaryName: string;
  visaType: string;
  visaSub?: string;
  stageLabel: string;
  /** 0–100. Below 33 renders red, 33–66 amber, ≥66 green/accent. */
  stagePercent: number;
  nextAction?: string;
  nextDue?: string;
  assigneeInitials?: string;
  assigneeLabel?: string;
  updatedLabel: string;
};

/** Shared 6-column grid template. Used by both row and header so the
 *  header label positions match the row cells exactly. Compact mins
 *  let the grid fit in the dashboard's narrow main column at `lg`. */
export const CASELINE_GRID =
  "md:grid-cols-[28px_minmax(120px,1.2fr)_minmax(64px,0.5fr)_minmax(120px,1.2fr)_minmax(120px,1fr)_72px]";

export function Caseline(props: CaselineProps): React.ReactElement {
  return (
    <Link
      href={APP_ROUTES.case(props.caseId)}
      className={`flex flex-col gap-2 rounded-md border border-transparent px-3 py-3 text-sm transition hover:border-[var(--border,rgba(0,0,0,0.08))] hover:bg-[var(--surface,#fff)] md:grid md:items-center md:gap-3 ${CASELINE_GRID}`}
    >
      <div className="flex items-center gap-3 md:contents">
        <Avatar name={props.beneficiaryName} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{props.beneficiaryName}</div>
          <div
            className="mono truncate text-[10px] uppercase tracking-wider"
            style={{ color: "var(--ink-muted)" }}
          >
            {shortCaseId(props.caseId)}
          </div>
        </div>
        <div
          className="mono shrink-0 text-[11px] uppercase tracking-wider md:hidden"
          style={{ color: "var(--ink-muted)" }}
        >
          {props.updatedLabel}
        </div>
      </div>

      <div className="min-w-0 md:block">
        <div className="mono text-xs uppercase tracking-wider">
          {props.visaType}
        </div>
        {props.visaSub ? (
          <div
            className="text-[11px]"
            style={{ color: "var(--ink-muted)" }}
          >
            {props.visaSub}
          </div>
        ) : null}
      </div>

      <div className="min-w-0">
        <StageBar percent={props.stagePercent} />
        <div
          className="mt-1 text-[11px] leading-snug break-words"
          style={{ color: "var(--ink-soft)" }}
        >
          {props.stageLabel}
        </div>
      </div>

      <div className="min-w-0">
        {props.nextAction ? (
          <>
            <div className="text-xs leading-snug break-words">
              {props.nextAction}
            </div>
            {props.nextDue ? (
              <div
                className="mono text-[10px] uppercase tracking-wider"
                style={{ color: "var(--ink-muted)" }}
              >
                {props.nextDue}
              </div>
            ) : null}
          </>
        ) : (
          <span style={{ color: "var(--ink-muted)" }}>—</span>
        )}
      </div>

      <div
        className="hidden text-right text-[11px] md:block"
        style={{ color: "var(--ink-muted)" }}
      >
        {props.updatedLabel}
      </div>
    </Link>
  );
}

function Avatar(props: { name: string }): React.ReactElement {
  const initials = props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium"
      style={{
        background: "var(--ink)",
        color: "var(--cream, white)",
      }}
    >
      {initials || "·"}
    </span>
  );
}

function StageBar(props: { percent: number }): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, props.percent));
  const tone =
    clamped < 33
      ? "var(--error, #b1330e)"
      : clamped < 66
        ? "var(--warning, #b1830e)"
        : "var(--accent, #1F3D2F)";
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ background: "var(--surface-sunken, rgba(0,0,0,0.06))" }}
    >
      <div
        className="h-full"
        style={{ width: `${clamped}%`, background: tone }}
      />
    </div>
  );
}
