import Link from "next/link";
import { Card } from "@/components/ui";
import { APP_ROUTES } from "@/config";

/**
 * Stage 11 right-rail "Today" card. Renders up to N attorney-actionable
 * items derived server-side via `me.todayTasks`.
 *
 * Each item links to the underlying case so an "Approve" or "Upload"
 * action is one click away. Overdue items get a leading red dot per
 * mockup `dashboard.html .task-card .urgent`.
 */
export type TodayItem = {
  id: string;
  label: string;
  sub: string;
  overdue: boolean;
};

export type TodayCardProps = {
  items: ReadonlyArray<TodayItem>;
};

export function TodayCard(props: TodayCardProps): React.ReactElement {
  return (
    <Card title="Today">
      {props.items.length === 0 ? (
        <p
          className="text-xs"
          style={{ color: "var(--ink-muted)" }}
        >
          Nothing requires action right now. Time for a coffee.
        </p>
      ) : (
        <ul className="space-y-3">
          {props.items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: item.overdue
                    ? "var(--error, #b1330e)"
                    : "var(--accent, var(--ink))",
                }}
              />
              <Link
                href={APP_ROUTES.case(item.id)}
                className="min-w-0 flex-1 text-xs"
              >
                <span className="block truncate font-medium">
                  {item.label}
                </span>
                <span
                  className="block truncate"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {item.sub}
                </span>
              </Link>
              {item.overdue ? (
                <span
                  className="mono shrink-0 rounded-sm px-1.5 py-px text-[10px] uppercase tracking-wider"
                  style={{
                    background: "var(--error-soft, rgba(177,51,14,0.1))",
                    color: "var(--error, #b1330e)",
                  }}
                >
                  Overdue
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
