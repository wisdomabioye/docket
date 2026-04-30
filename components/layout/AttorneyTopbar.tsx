"use client";

import { usePathname } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import type { BreadcrumbItem } from "@/components/layout/Breadcrumbs";
import { APP_ROUTES } from "@/config";
import { Icon } from "@/components/ui/Icon";
import { shortCaseLabel } from "@/lib/case-id";

/**
 * Attorney-area topbar — derives breadcrumbs from the live pathname,
 * renders a stub search input (functionality lands when full-text
 * search arrives in Phase 2), plus a notification bell stub.
 *
 * Client component because `usePathname` is client-only. The cost is
 * a small hydration boundary at the top of every workspace page;
 * acceptable given the breadcrumb has to react to client-side
 * navigation.
 *
 * Path map: ordered, longest-prefix wins. Anything not matched falls
 * through to a single "Workspace" crumb so the bar never renders empty.
 */
export function AttorneyTopbar(): React.ReactElement {
  const pathname = usePathname();
  const breadcrumbs = breadcrumbsFor(pathname);

  return (
    <Topbar
      breadcrumbs={breadcrumbs}
      center={<SearchStub />}
      trailing={
        <button
          type="button"
          aria-label="Notifications"
          className="rounded-sm p-1.5 text-[var(--ink-muted)] hover:text-[var(--ink)]"
        >
          <Icon name="bell" size={16} />
        </button>
      }
    />
  );
}

function SearchStub(): React.ReactElement {
  return (
    <div
      className="flex w-full max-w-md items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
      style={{
        background: "var(--surface-sunken, var(--surface))",
        borderColor: "var(--border, rgba(0,0,0,0.08))",
        color: "var(--ink-muted)",
      }}
    >
      <Icon name="search" size={12} />
      <span className="flex-1">Search cases, clients, documents…</span>
      <kbd
        className="mono rounded-sm px-1.5 py-px text-[10px]"
        style={{
          background: "var(--surface)",
          color: "var(--ink-muted)",
        }}
      >
        ⌘K
      </kbd>
    </div>
  );
}

function breadcrumbsFor(pathname: string): ReadonlyArray<BreadcrumbItem> {
  // Order matters: more-specific patterns first.
  if (pathname === APP_ROUTES.dashboard) {
    return [{ label: "Dashboard" }];
  }
  if (pathname === APP_ROUTES.settings) {
    return [{ label: "Settings" }];
  }
  if (pathname === APP_ROUTES.newCase) {
    return [
      { label: "Dashboard", href: APP_ROUTES.dashboard },
      { label: "New case" },
    ];
  }
  // /case/{id}/...
  const caseMatch = pathname.match(/^\/case\/([^/]+)(\/.*)?$/);
  if (caseMatch) {
    const caseId = caseMatch[1]!;
    const tail = caseMatch[2] ?? "";
    const items: BreadcrumbItem[] = [
      { label: "Dashboard", href: APP_ROUTES.dashboard },
      { label: shortCaseLabel(caseId), href: APP_ROUTES.case(caseId) },
    ];
    if (tail.startsWith("/intake")) items.push({ label: "Intake" });
    else if (tail.startsWith("/documents/")) items.push({ label: "Document" });
    else if (tail.startsWith("/documents")) items.push({ label: "Documents" });
    else if (tail.startsWith("/build")) items.push({ label: "Build" });
    else if (tail.startsWith("/outputs/")) items.push({ label: "Output" });
    else if (tail.startsWith("/outputs")) items.push({ label: "Outputs" });
    else if (tail.startsWith("/package")) items.push({ label: "Package" });
    return items;
  }
  return [{ label: "Workspace" }];
}

