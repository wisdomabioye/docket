import type { ReactNode } from "react";

/**
 * Stage 11 app shell — 216px sidebar + scrolling main column. Used by
 * `(app)` and (eventually) `(admin)` group layouts. Pure server
 * component; sidebar/topbar are passed in as slots so each area
 * supplies its own (AttorneySidebar / AdminSidebar / AttorneyTopbar).
 *
 * Why a primitive vs. duplicating the grid in each layout: the rail
 * width, sticky behavior, and main-column scroll boundary are mockup-
 * level decisions; pages don't need to know them. AppShell encodes
 * the contract once.
 */
export type AppShellProps = {
  sidebar: ReactNode;
  topbar?: ReactNode;
  children: ReactNode;
};

export function AppShell(props: AppShellProps): React.ReactElement {
  return (
    <div
      className="flex min-h-screen"
      style={{ background: "var(--bg, var(--surface-sunken))" }}
    >
      {props.sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {props.topbar}
        <main className="flex-1 px-6 py-6 lg:px-8 lg:py-8">{props.children}</main>
      </div>
    </div>
  );
}
