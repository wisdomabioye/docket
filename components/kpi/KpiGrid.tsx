import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Responsive grid for `KpiCard`s. Defaults to 4 cols on `lg`, collapses
 * to 2 on `md`, 1 on small screens. The mockups use 4 across.
 */

export function KpiGrid(props: {
  children: ReactNode;
  /** Override column count if a page wants a 3-col hero strip. */
  cols?: 2 | 3 | 4;
}): React.ReactElement {
  const cols = props.cols ?? 4;
  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2",
        cols === 2 && "lg:grid-cols-2",
        cols === 3 && "lg:grid-cols-3",
        cols === 4 && "lg:grid-cols-4",
      )}
    >
      {props.children}
    </div>
  );
}
