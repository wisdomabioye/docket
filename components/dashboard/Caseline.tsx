import Link from "next/link";
import { APP_ROUTES } from "@/config";
import { shortCaseId } from "@/lib/case-id";

/**
 * Stage 11 dashboard caseline row — grid layout that mirrors
 * `dashboard.html .caseline`. Replaces the plain `<table><tr>` rows
 * the dashboard used to ship with.
 *
 * Each column is a slot the caller fills:
 *   - avatar / initials block
 *   - client name + case-id sub
 *   - visa type + sub
 *   - stage progress (label + percent, rendered as a thin bar)
 *   - next-action label + due hint
 *   - assignee initials + name
 *   - last-updated timestamp
 *
 * Server-component-friendly. Whole row is a `<Link>` so the entire
 * caseline is clickable; nested kebab/buttons for case-row actions
 * land in Stage 12 (table row actions).
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

export function Caseline(props: CaselineProps): React.ReactElement {
  return (
    <Link
      href={APP_ROUTES.case(props.caseId)}
      className="grid items-center gap-3 rounded-md border border-transparent px-3 py-3 text-sm transition hover:border-[var(--border,rgba(0,0,0,0.08))] hover:bg-[var(--surface,#fff)]"
      style={{
        gridTemplateColumns:
          "32px minmax(160px, 1.2fr) minmax(80px, 0.6fr) minmax(140px, 1.2fr) minmax(140px, 1fr) 90px",
      }}
    >
      <Avatar name={props.beneficiaryName} />
      <div className="min-w-0">
        <div className="truncate font-medium">{props.beneficiaryName}</div>
        <div
          className="mono truncate text-[10px] uppercase tracking-wider"
          style={{ color: "var(--ink-muted)" }}
        >
          {shortCaseId(props.caseId)}
        </div>
      </div>
      <div className="min-w-0">
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
          className="mt-1 truncate text-[11px]"
          style={{ color: "var(--ink-soft)" }}
        >
          {props.stageLabel}
        </div>
      </div>
      <div className="min-w-0">
        {props.nextAction ? (
          <>
            <div className="truncate text-xs">{props.nextAction}</div>
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
        className="text-right text-[11px]"
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
      className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-medium"
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

