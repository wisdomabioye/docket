import Link from "next/link";
import { Card } from "@/components/ui";
import { APP_ROUTES } from "@/config";
import { formatRelative } from "@/lib/utils";

/**
 * Stage 11 right-rail activity feed. Renders the newest case_events
 * across the attorney's cases (server-fetched via `me.activityFeed`).
 *
 * `eventType` is a free-text string per `case_events.event_type`
 * column comment — this component formats known types into
 * human-readable copy and falls back to the raw token for unknowns.
 *
 * Mockup: `dashboard.html .activity` (l. 489–497).
 */
export type ActivityItem = {
  id: string;
  caseId: string;
  actorType: "user" | "system" | "computer";
  eventType: string;
  beneficiary: string | null;
  createdAt: Date;
};

export type ActivityFeedProps = {
  items: ReadonlyArray<ActivityItem>;
};

export function ActivityFeed(
  props: ActivityFeedProps,
): React.ReactElement {
  return (
    <Card title="Recent activity">
      {props.items.length === 0 ? (
        <p
          className="text-xs"
          style={{ color: "var(--ink-muted)" }}
        >
          No activity yet — events appear here as cases progress.
        </p>
      ) : (
        <ul className="space-y-3 text-xs">
          {props.items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <ActorDot actorType={item.actorType} />
              <Link
                href={APP_ROUTES.case(item.caseId)}
                className="min-w-0 flex-1 leading-snug"
              >
                <span className="block">
                  {humanizeEvent(item.eventType, item.actorType)}
                </span>
                <span
                  className="mono mt-0.5 block text-[10px] uppercase tracking-wider"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {item.beneficiary ?? "Unnamed"} · {formatRelative(item.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActorDot(props: {
  actorType: "user" | "system" | "computer";
}): React.ReactElement {
  const color =
    props.actorType === "computer"
      ? "var(--accent, var(--ink))"
      : props.actorType === "system"
        ? "var(--info, var(--ink-muted))"
        : "var(--ink-muted)";
  return (
    <span
      aria-hidden="true"
      className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

function humanizeEvent(
  type: string,
  actorType: "user" | "system" | "computer",
): string {
  const subject =
    actorType === "computer"
      ? "Docket"
      : actorType === "system"
        ? "System"
        : "You";
  switch (type) {
    case "case.created":
      return `${subject} created a case`;
    case "case.fee_logged":
      return `${subject} logged the case fee`;
    case "output.generated":
      return `${subject} generated an output`;
    case "output.approved":
      return `${subject} approved an output`;
    case "output.regenerated":
      return `${subject} regenerated an output`;
    case "build.requested":
      return `${subject} requested a build`;
    case "build.completed":
      return `${subject} finished the build`;
    case "build.failed":
      return `${subject} hit a build failure`;
    case "document.uploaded":
      return `${subject} uploaded a document`;
    case "extraction.failed":
      return `${subject} hit an extraction failure`;
    default:
      // Unknown event — surface the raw token so a developer can fix
      // the humanizer without losing visibility.
      return `${subject} · ${type}`;
  }
}
