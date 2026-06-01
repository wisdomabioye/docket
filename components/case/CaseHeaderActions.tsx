import Link from "next/link";
import { APP_ROUTES } from "@/config";
import { deriveCasePrimaryAction } from "@/lib/case-stage";
import type { CaseStatus } from "@/lib/case-status";

/**
 * Case-header right-side action row — `⇣ Package` deep-link plus the
 * single status-aware primary CTA.
 *
 * The primary action comes from `deriveCasePrimaryAction` (the ONE
 * source shared with the rail hint, the dashboard column, and the
 * Stage-13 action card) — this component no longer keeps its own
 * status→action map. In-progress (extracting/building) and terminal
 * (filed/archived) statuses resolve to `null`, so only the `⇣ Package`
 * deep-link shows; the action card surfaces the in-progress/blocked
 * detail.
 */

export type CaseHeaderActionsProps = {
  caseId: string;
  status: CaseStatus;
};

export function CaseHeaderActions(
  props: CaseHeaderActionsProps,
): React.ReactElement {
  const primary = deriveCasePrimaryAction(props.status, props.caseId);
  return (
    <div className="flex items-center gap-2">
      <Link
        href={APP_ROUTES.casePackage(props.caseId)}
        className="rounded-md border px-3 py-1.5 text-xs font-medium"
        style={{
          borderColor: "var(--border, rgba(0,0,0,0.15))",
          color: "var(--ink)",
          background: "var(--surface, white)",
        }}
      >
        ⇣ Package
      </Link>
      {primary ? (
        <Link
          href={primary.href}
          className="rounded-md border px-3 py-1.5 text-xs font-medium text-[var(--cream)]"
          style={{
            borderColor: "var(--ink)",
            background: "var(--ink)",
          }}
        >
          {primary.label} →
        </Link>
      ) : null}
    </div>
  );
}
