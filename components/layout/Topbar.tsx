import type { ReactNode } from "react";
import { Breadcrumbs, type BreadcrumbItem } from "./Breadcrumbs";

/**
 * Stage 11 topbar — sticky strip at the top of `(app)` and `(admin)`
 * page bodies. Hosts breadcrumbs, an optional center slot (search
 * input or page-level controls), and an optional trailing slot
 * (icon-button cluster: bell, help).
 *
 * Mockup: dashboard.html `.topbar` (l. 184-194), case-overview.html
 * topbar, etc. Same chrome on every attorney + admin route.
 *
 * Slots are intentionally generic — Topbar doesn't know about search
 * or notifications. Pages compose the chrome they need.
 */
export type TopbarProps = {
  breadcrumbs: ReadonlyArray<BreadcrumbItem>;
  /** Optional center area (e.g. command-K search). Hidden on small
   *  viewports to keep the bar from wrapping. */
  center?: ReactNode;
  /** Optional trailing icon-button slot. */
  trailing?: ReactNode;
};

export function Topbar(props: TopbarProps): React.ReactElement {
  return (
    <header
      className="sticky top-0 z-10 flex h-12 items-center gap-4 border-b px-4"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border, rgba(0,0,0,0.08))",
      }}
    >
      <Breadcrumbs items={props.breadcrumbs} />
      {props.center ? (
        <div className="hidden flex-1 justify-center md:flex">{props.center}</div>
      ) : (
        <div className="flex-1" />
      )}
      {props.trailing ? (
        <div className="flex items-center gap-1.5">{props.trailing}</div>
      ) : null}
    </header>
  );
}
