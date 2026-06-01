/**
 * Humanizes a `case_events` row into a short activity sentence. ONE
 * source shared by the dashboard activity feed and the case-overview
 * feed (Stage 13 / #72) so the two never drift.
 *
 * The cases here are the ACTUAL `eventType` values emitted across the
 * codebase (grep `eventType:` in `server/`): the prior dashboard-local
 * humanizer drifted — it handled imagined `output.*`/`build.*` tokens
 * and missed the real `case.status_changed` / `case.beneficiary_updated`
 * / `document.deleted` / `recommender.*` ones, so they fell through to a
 * raw token. Keep this list in sync with the emit sites.
 */

export type CaseEventActor = "user" | "system" | "computer";

const SUBJECT: Record<CaseEventActor, string> = {
  user: "You",
  computer: "Docket",
  system: "System",
};

/** Safely read a string field from the event's `details` jsonb. */
function detailString(details: unknown, key: string): string | null {
  if (details && typeof details === "object" && key in details) {
    const v = (details as Record<string, unknown>)[key];
    return typeof v === "string" ? v : null;
  }
  return null;
}

export function describeCaseEvent(
  eventType: string,
  actorType: CaseEventActor,
  details?: unknown,
): string {
  const subject = SUBJECT[actorType];
  switch (eventType) {
    case "case.created":
      return `${subject} created the case`;
    case "case.beneficiary_updated":
      return `${subject} updated beneficiary info`;
    case "case.status_changed": {
      const to = detailString(details, "to");
      return to
        ? `Status changed to ${to.replace(/_/g, " ")}`
        : `${subject} changed the case status`;
    }
    case "case.fee_logged":
      return `${subject} logged the case fee`;
    case "document.uploaded":
      return `${subject} uploaded a document`;
    case "document.deleted":
      return `${subject} removed a document`;
    case "recommender.added":
      return `${subject} added a recommender`;
    case "recommender.removed":
      return `${subject} removed a recommender`;
    case "recommender.updated":
      return `${subject} updated a recommender`;
    case "recommender.reordered":
      return `${subject} reordered recommenders`;
    default:
      // Unknown event — surface the raw token so a developer notices and
      // extends this map, without hiding activity from the attorney.
      return `${subject} · ${eventType}`;
  }
}
