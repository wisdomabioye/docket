import Link from "next/link";
import { Badge, type BadgeVariant } from "@/components/ui";
import { APP_ROUTES } from "@/config";
import { shortCaseId } from "@/lib/case-id";

/**
 * Stage 11 case-detail header. Mirrors `case-overview.html .case-hdr`:
 * eyebrow case-id + serif beneficiary name + meta sub-line + status
 * pill + tabs row.
 *
 * Tabs (5 — matches mockup): Overview / Intake / Documents / Outputs /
 * Package. `Build` is intentionally NOT a top-level tab — the mockup
 * surfaces the build page via the header's `Review drafts →` /
 * `Build →` action button (passed in via `actions`), not the tab strip.
 *
 * The active tab is matched by `current` prop (set by each child page).
 */

export type CaseTab =
  | "overview"
  | "intake"
  | "documents"
  | "outputs"
  | "package";

export type CaseHeaderProps = {
  caseId: string;
  beneficiaryName: string;
  visaType: string;
  /** Optional sub-line under the name (nationality, criteria count). */
  meta?: string;
  status: string;
  /** Active tab — drives the underline. */
  current: CaseTab;
  /** Right-aligned action slot (e.g. Build button). */
  actions?: React.ReactNode;
};

export function CaseHeader(props: CaseHeaderProps): React.ReactElement {
  return (
    <header
      className="border-b pb-4"
      style={{ borderColor: "var(--border, rgba(0,0,0,0.08))" }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p
            className="mono text-[10px] uppercase tracking-wider"
            style={{ color: "var(--ink-muted)" }}
          >
            Case · {props.visaType} · {shortCaseId(props.caseId)}
          </p>
          <h1
            className="mt-2 text-3xl tracking-tight"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          >
            {props.beneficiaryName}
          </h1>
          {props.meta ? (
            <p
              className="mt-1 text-sm"
              style={{ color: "var(--ink-muted)" }}
            >
              {props.meta}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={props.status} />
          {props.actions}
        </div>
      </div>
      <CaseTabs caseId={props.caseId} current={props.current} />
    </header>
  );
}

function CaseTabs(props: {
  caseId: string;
  current: CaseTab;
}): React.ReactElement {
  const tabs: ReadonlyArray<{ key: CaseTab; label: string; href: string }> = [
    { key: "overview", label: "Overview", href: APP_ROUTES.case(props.caseId) },
    { key: "intake", label: "Intake", href: APP_ROUTES.caseIntake(props.caseId) },
    {
      key: "documents",
      label: "Documents",
      href: APP_ROUTES.caseDocuments(props.caseId),
    },
    {
      key: "outputs",
      label: "Outputs",
      href: APP_ROUTES.caseOutputs(props.caseId),
    },
    {
      key: "package",
      label: "Package",
      href: APP_ROUTES.casePackage(props.caseId),
    },
  ];
  return (
    <nav className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {tabs.map((tab) => {
        const active = tab.key === props.current;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className="relative py-2 transition"
            style={{
              color: active ? "var(--ink)" : "var(--ink-muted)",
              fontWeight: active ? 500 : 400,
            }}
          >
            {tab.label}
            {active ? (
              <span
                aria-hidden="true"
                className="absolute -bottom-px left-0 right-0 h-0.5"
                style={{ background: "var(--ink)" }}
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function StatusBadge(props: { status: string }): React.ReactElement {
  return (
    <Badge variant={badgeVariantFor(props.status)}>
      {props.status.replace(/_/g, " ")}
    </Badge>
  );
}

function badgeVariantFor(status: string): BadgeVariant {
  switch (status) {
    case "filed":
    case "delivered":
    case "approved":
      return "success";
    case "build_failed":
    case "needs_revision":
      return "error";
    case "in_review":
    case "draft_ready":
      return "info";
    case "intake":
    case "documents_pending":
    case "extracting":
    case "ready_to_build":
    case "building":
      return "neutral";
    default:
      return "neutral";
  }
}

