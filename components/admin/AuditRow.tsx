import { Badge, type BadgeVariant } from "@/components/ui/Badge";

/**
 * One row in the audit log stream. Color-coded event-type badge (filing,
 * mutation, auth, admin override, etc.) + monospace timestamp +
 * sans-serif message + muted actor/IP.
 *
 * The `actorType`/`action` → badge variant + label mapping is centralized
 * here so every consumer (overview Ops Inbox, audit log page, future
 * email digests) renders the same way.
 */

export type AuditEvent = {
  id: string;
  /** ISO timestamp string. */
  timestamp: string;
  /** `audit_log.action` — e.g. `"attorney.activate"`, `"waitlist.approve"`. */
  action: string;
  /** Human-readable summary. */
  message: string;
  actorEmail: string | null;
  ipAddress: string | null;
};

const ACTION_BUCKET: Array<{
  match: RegExp;
  label: string;
  variant: BadgeVariant;
}> = [
  { match: /^filing\./, label: "FILING", variant: "success" },
  { match: /^signature\./, label: "SIGNATURE", variant: "success" },
  { match: /^auth\./, label: "AUTH", variant: "info" },
  { match: /^admin\.bootstrap$/, label: "ADMIN·BOOT", variant: "warning" },
  { match: /\.override$/, label: "ADMIN·OVERRIDE", variant: "error" },
  { match: /^attorney\.|^waitlist\./, label: "MUTATION", variant: "warning" },
  { match: /^case\./, label: "MUTATION", variant: "warning" },
  { match: /^compute\.|^ai\./, label: "AI·DRAFT", variant: "neutral" },
  { match: /^billing\./, label: "BILLING", variant: "accent" },
];

export function classifyAuditAction(action: string): {
  label: string;
  variant: BadgeVariant;
} {
  for (const bucket of ACTION_BUCKET) {
    if (bucket.match.test(action)) return bucket;
  }
  // Unknown action: surface the prefix only (e.g. "case.beneficiary_updated"
  // → `CASE`) so the badge stays compact. Without this the entire
  // dotted-path renders as the label and overflows the cell at narrow
  // widths.
  const prefix = action.includes(".")
    ? (action.split(".")[0] ?? action)
    : action;
  return { label: prefix.toUpperCase(), variant: "neutral" };
}

export function AuditRow(props: {
  event: AuditEvent;
}): React.ReactElement {
  const { label, variant } = classifyAuditAction(props.event.action);
  const ts = new Date(props.event.timestamp);
  return (
    <li
      className="grid items-baseline gap-3 border-b px-4 py-2 text-xs last:border-b-0"
      style={{
        borderColor: "var(--border)",
        gridTemplateColumns: "180px 110px 1fr auto",
      }}
    >
      <span className="mono text-[var(--ink-muted)]">{formatUtc(ts)}</span>
      <Badge variant={variant} mono>
        {label}
      </Badge>
      <span>{props.event.message}</span>
      <span className="mono text-[var(--ink-muted)]">
        {props.event.actorEmail ?? "system"}
        {props.event.ipAddress ? ` · ${props.event.ipAddress}` : ""}
      </span>
    </li>
  );
}

function formatUtc(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}
