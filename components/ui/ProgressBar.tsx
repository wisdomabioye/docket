/**
 * Inline horizontal progress bar. Used in the cases stage column ("57% ·
 * 5/7 outputs"), revenue hero ("72%"), compute budget ("68% of $48k"),
 * etc.
 *
 * `tone` defaults to `accent` (forest green); pass `warning` for
 * <-threshold values, `error` for over-budget. Calling code decides the
 * threshold logic — the component is dumb on purpose.
 */

export type ProgressTone = "accent" | "warning" | "error" | "success";

const TONE_COLOR: Record<ProgressTone, string> = {
  accent: "var(--accent)",
  warning: "var(--warning)",
  error: "var(--error)",
  success: "var(--success)",
};

export function ProgressBar(props: {
  /** 0..100. Clamped on render. */
  value: number;
  tone?: ProgressTone;
  /** Total bar width — pixels or any CSS length. Defaults to "100%". */
  width?: string;
  className?: string;
}): React.ReactElement {
  const value = Math.max(0, Math.min(100, props.value));
  const tone = props.tone ?? "accent";
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full ${props.className ?? ""}`}
      style={{
        background: "var(--surface-deep)",
        width: props.width ?? "100%",
      }}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full"
        style={{ width: `${value}%`, background: TONE_COLOR[tone] }}
      />
    </div>
  );
}
