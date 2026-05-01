"use client";

import { usePathname } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { SearchBar } from "@/components/layout/SearchBar";
import type { BreadcrumbItem } from "@/components/layout/Breadcrumbs";
import { APP_ROUTES } from "@/config";
import { Icon } from "@/components/ui/Icon";
import { shortCaseLabel } from "@/lib/case-id";

/**
 * Attorney-area topbar — derives breadcrumbs from the live pathname,
 * mounts the global `SearchBar` (Stage 11 W5; replaced the prior
 * `SearchStub`), plus a notification bell stub.
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
      center={<SearchBar />}
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

