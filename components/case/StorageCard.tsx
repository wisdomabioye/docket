import { Card, ProgressBar, type ProgressTone } from "@/components/ui";

/**
 * Stage 11 β storage card for the Documents right rail. Mockup
 * `documents.html` (l. 380-393): `48 / 500 MB` with a thin bar.
 *
 * Tone flips when the bar crosses thresholds:
 *   - <60%  → accent (default)
 *   - <85%  → warning
 *   - ≥85%  → error
 *
 * Tooltip / hint copy stays terse — the cap rationale lives in
 * `lib/visa-criteria.ts:PER_CASE_STORAGE_BYTES`.
 */

const MB = 1024 * 1024;

export type StorageCardProps = {
  usedBytes: bigint;
  capBytes: bigint;
  documentCount: number;
};

export function StorageCard(props: StorageCardProps): React.ReactElement {
  const percent = computePercent(props.usedBytes, props.capBytes);
  const tone = toneFor(percent);
  return (
    <Card title="Storage">
      <div className="flex items-baseline justify-between">
        <p className="text-2xl font-semibold leading-none">
          <span className="mono">{formatMb(props.usedBytes)}</span>
          <span
            className="ml-1 text-xs font-normal"
            style={{ color: "var(--ink-muted)" }}
          >
            / {formatMb(props.capBytes)} MB
          </span>
        </p>
        <span
          className="mono text-[10px] uppercase tracking-wider"
          style={{ color: "var(--ink-muted)" }}
        >
          {props.documentCount}{" "}
          {props.documentCount === 1 ? "document" : "documents"}
        </span>
      </div>
      <div className="mt-3">
        <ProgressBar value={percent} tone={tone} />
      </div>
      <p
        className="mt-3 text-[11px]"
        style={{ color: "var(--ink-muted)" }}
      >
        Per-case limit. Contact admin to raise.
      </p>
    </Card>
  );
}

/** Bytes → MB rounded to one decimal, returned as a string ("48.2"). */
function formatMb(bytes: bigint): string {
  // Use Number for the division — safe because per-case cap is bounded
  // (500 MB ≪ 2^53). Round to one decimal to avoid jittery long values.
  const mb = Number(bytes) / MB;
  return (Math.round(mb * 10) / 10).toFixed(1);
}

function computePercent(used: bigint, cap: bigint): number {
  if (cap === 0n) return 0;
  // Ratio in [0, 100]; clamp the upper bound so a corrupt over-cap
  // value still renders cleanly.
  const ratio = Number((used * 1000n) / cap) / 10;
  return Math.max(0, Math.min(100, ratio));
}

function toneFor(percent: number): ProgressTone {
  if (percent >= 85) return "error";
  if (percent >= 60) return "warning";
  return "accent";
}
