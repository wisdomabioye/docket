import Link from "next/link";
import { APP_ROUTES } from "@/config";

/**
 * Case-header right-side action row — `⇣ Package` deep-link plus a
 * status-aware primary CTA (Build → / Review drafts → / Mark filed →).
 *
 * Slotted into `<CaseHeader actions={...}>` on every tab so the
 * attorney can launch a build or jump to review without bouncing back
 * to the Overview tab. Identical visual to mockup
 * `case-overview.html` l. 110-114.
 *
 *   pre-build  (intake → ready_to_build / build_failed) → "Build →"
 *   post-build (building → approved)                    → "Review drafts →"
 *   terminal   (delivered/filed)                        → mark/view-only
 *
 * The list of statuses that map to each CTA mirrors the case-status
 * lifecycle in `lib/case-status.ts` — extend both files together when
 * adding statuses so the header stays in sync.
 */

export type CaseHeaderActionsProps = {
  caseId: string;
  status: string;
};

export function CaseHeaderActions(
  props: CaseHeaderActionsProps,
): React.ReactElement {
  const primary = primaryActionFor(props.status, props.caseId);
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
          {primary.label}
        </Link>
      ) : null}
    </div>
  );
}

function primaryActionFor(
  status: string,
  caseId: string,
): { label: string; href: string } | null {
  switch (status) {
    case "intake":
    case "documents_pending":
    case "extracting":
    case "ready_to_build":
    case "build_failed":
      return { label: "Build →", href: APP_ROUTES.caseBuild(caseId) };
    case "building":
    case "draft_ready":
    case "in_review":
    case "needs_revision":
    case "approved":
      return { label: "Review drafts →", href: APP_ROUTES.caseOutputs(caseId) };
    case "delivered":
      return { label: "Mark as filed →", href: APP_ROUTES.casePackage(caseId) };
    case "filed":
      return { label: "View package", href: APP_ROUTES.casePackage(caseId) };
    default:
      return null;
  }
}
