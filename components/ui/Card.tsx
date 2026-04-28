import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Bordered container with optional title strip. The strip lays out as
 * `title  ········  meta/actions`, matching every "Ops inbox", "Top firms
 * QTD", "Compute budget MTD", etc. card in the mockups.
 */

export function Card(props: {
  title?: string;
  /** Right-aligned header content (count, sort dropdown, link). */
  meta?: ReactNode;
  children: ReactNode;
  /** Drop the inner padding (used when children supply their own table padding). */
  flush?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <section
      className={cn(
        "rounded-sm border",
        props.className,
      )}
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
      }}
    >
      {props.title ? (
        <header
          className="flex items-center justify-between border-b px-4 py-2.5"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="text-sm font-medium tracking-tight">{props.title}</h2>
          {props.meta ? (
            <div className="text-xs text-[var(--ink-muted)]">{props.meta}</div>
          ) : null}
        </header>
      ) : null}
      <div className={props.flush ? "" : "p-4"}>{props.children}</div>
    </section>
  );
}
