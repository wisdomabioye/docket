import { cn } from "@/lib/utils";

/**
 * Status / severity pill. Variants map to the semantic color tokens; the
 * `soft` background + saturated text combo matches the mockups (Hi/Md/Lo
 * tags on attorneys, OK/WARN strips on compute budget, event-type tags
 * on the audit stream).
 */

export type BadgeVariant =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info";

const VARIANT_STYLE: Record<BadgeVariant, { bg: string; fg: string }> = {
  neutral: { bg: "var(--surface-sunken)", fg: "var(--ink-muted)" },
  accent: { bg: "var(--accent-soft)", fg: "var(--accent)" },
  success: { bg: "var(--success-soft)", fg: "var(--success)" },
  warning: { bg: "var(--warning-soft)", fg: "var(--warning)" },
  error: { bg: "var(--error-soft)", fg: "var(--error)" },
  info: { bg: "var(--info-soft)", fg: "var(--info)" },
};

export function Badge(props: {
  variant?: BadgeVariant;
  children: React.ReactNode;
  /** Render in monospace (status codes, hash suffixes, event tags). */
  mono?: boolean;
  className?: string;
}): React.ReactElement {
  const style = VARIANT_STYLE[props.variant ?? "neutral"];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]",
        props.mono && "mono",
        props.className,
      )}
      style={{ background: style.bg, color: style.fg }}
    >
      {props.children}
    </span>
  );
}
