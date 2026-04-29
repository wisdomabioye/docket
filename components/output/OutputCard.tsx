import Link from "next/link";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui";
import { OUTPUT_TYPE_DISPLAY, readRecommenderName } from "@/lib/output-types";
import { APP_ROUTES } from "@/config";
import type { OutputType } from "@/server/services/computer/types";

/**
 * Grid card per output. Linked anchor → output detail page. Shows:
 *   - Sequence label + display name (per `OUTPUT_TYPE_DISPLAY`)
 *   - Status pill (Approved / Draft)
 *   - Optional subgroup subtitle for `recommendation_letter_template`
 *     (recommender name from metadata)
 *   - Content-length meta (chars; small font, monospace)
 *   - Last-updated relative date
 *
 * Pure presentational — receives an item from `output.list`'s slim
 * projection. No `content` text is shipped to keep the card payload
 * small even for cases with 50KB+ of prose per output.
 */

export type OutputCardProps = {
  caseId: string;
  /** Slim projection from `getCurrentOutputsForList`. */
  item: {
    id: string;
    outputType: OutputType;
    outputVersion: number;
    subgroupKey: string | null;
    metadata: unknown;
    attorneyApproved: boolean;
    contentLength: number;
    updatedAt: Date;
  };
  /** 1-based sequence label rendered top-left ("01", "02", …). The grid
   *  parent computes this so the same card component can render in
   *  ordered + unordered surfaces. */
  sequence: number;
};

export function OutputCard(props: OutputCardProps): ReactElement {
  const display = OUTPUT_TYPE_DISPLAY[props.item.outputType];
  const subtitle = readRecommenderName({
    outputType: props.item.outputType,
    metadata: props.item.metadata,
  });

  return (
    <Link
      href={APP_ROUTES.output(props.caseId, props.item.id)}
      className="flex min-h-[160px] flex-col gap-2 rounded-sm border p-4 transition-colors hover:shadow-sm focus:outline-none focus-visible:ring-2"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="text-[11px] uppercase tracking-wider"
          style={{
            color: "var(--ink-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {String(props.sequence).padStart(2, "0")} · {display}
        </span>
        <Badge variant={props.item.attorneyApproved ? "success" : "neutral"}>
          {props.item.attorneyApproved
            ? "Approved"
            : `Draft · v${props.item.outputVersion}`}
        </Badge>
      </div>

      <h3
        className="text-[15px] font-semibold leading-tight tracking-tight"
        style={{ color: "var(--ink)" }}
      >
        {subtitle ?? display}
      </h3>

      <div className="flex-1" />

      <div
        className="flex items-center justify-between border-t border-dashed pt-2 text-[11px]"
        style={{
          borderColor: "var(--border)",
          color: "var(--ink-muted)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span>
          v{props.item.outputVersion} ·{" "}
          <strong style={{ color: "var(--ink)", fontWeight: 500 }}>
            {formatCharCount(props.item.contentLength)}
          </strong>
        </span>
        <time dateTime={props.item.updatedAt.toISOString()}>
          {formatRelative(props.item.updatedAt)}
        </time>
      </div>
    </Link>
  );
}

function formatCharCount(chars: number): string {
  if (chars < 1000) return `${chars} chars`;
  if (chars < 10_000) return `${(chars / 1000).toFixed(1)} kc`;
  return `${Math.round(chars / 1000)} kc`;
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function formatRelative(d: Date): string {
  const diffMs = d.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return RELATIVE.format(diffSec, "second");
  if (abs < 3600) return RELATIVE.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return RELATIVE.format(Math.round(diffSec / 3600), "hour");
  return RELATIVE.format(Math.round(diffSec / 86400), "day");
}
