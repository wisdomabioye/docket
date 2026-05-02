/**
 * Typed PostHog event taxonomy.
 *
 * Single source of truth for every event name and its payload shape.
 * Adding a new event = adding a discriminated-union member here, then
 * the typed `track()` wrappers (in `lib/analytics/client.ts` and
 * `server/services/analytics/server.ts`) refuse anything that doesn't
 * match. No string literals at call sites.
 *
 * Naming: `<noun>.<verb_past_tense>` — matches Sentry breadcrumb style,
 * matches PostHog convention (`signup_completed`, not `userSignup`),
 * and groups well in PostHog's event-name autocomplete.
 *
 * PII discipline: payloads here MUST NOT include `email`, `fullName`,
 * `beneficiaryName`, `extractedText`, or document content. Only IDs,
 * enums, counts, durations, and booleans. The runtime audit in
 * `lib/analytics/pii-guard.ts` re-validates this at emit time so a
 * future event addition cannot silently leak PII.
 */

import type {
  AttorneyStatus,
  CaseStatus,
  DocumentType,
  OutputType,
  VisaType,
} from "@/lib/constants";

/** All event names — exhaustive. Used as PostHog's `event` string. */
export const EVENT_NAMES = [
  // Auth (1)
  "auth.signed_in",
  // Attorney lifecycle (2)
  "attorney.onboarded",
  "attorney.activated",
  // Case lifecycle (4)
  "case.created",
  "case.intake_submitted",
  "case.build_requested",
  "case.archived",
  // Documents (2)
  "document.uploaded",
  "document.deleted",
  // Outputs (4)
  "output.viewed",
  "output.draft_saved",
  "output.version_saved",
  "output.approved",
  // Package (1)
  "package.exported",
  // Search (1)
  "search.performed",
  // Admin (2)
  "admin.attorney_status_changed",
  "admin.case_reassigned",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/**
 * Payload schemas, keyed by event name. The discriminated union is the
 * type the `track()` wrappers accept. Keep payload keys snake_case —
 * PostHog's UI groups by the literal key string and snake_case is the
 * dominant convention in their docs + recipes.
 */
export type EventPayloads = {
  "auth.signed_in": {
    provider: "google" | "microsoft" | "apple";
    is_new_user: boolean;
  };
  "attorney.onboarded": {
    attorney_id: string;
  };
  "attorney.activated": {
    attorney_id: string;
  };
  "case.created": {
    case_id: string;
    visa_type: VisaType;
  };
  "case.intake_submitted": {
    case_id: string;
    visa_type: VisaType;
    /** Number of intake fields the attorney filled in (capped count, no values). */
    field_count: number;
  };
  "case.build_requested": {
    case_id: string;
    visa_type: VisaType;
    document_count: number;
  };
  "case.archived": {
    case_id: string;
    /** Status the case was in when archived — useful for funnel analysis. */
    prior_status: CaseStatus;
  };
  "document.uploaded": {
    case_id: string;
    document_id: string;
    document_type: DocumentType;
    /** Bytes — bucket on the dashboard, not raw filename. */
    size_bytes: number;
    /** MIME type — generic e.g. `application/pdf`. */
    mime_type: string;
  };
  "document.deleted": {
    case_id: string;
    document_id: string;
  };
  "output.viewed": {
    case_id: string;
    output_id: string;
    output_type: OutputType;
    version: number;
  };
  "output.draft_saved": {
    case_id: string;
    output_id: string;
    /** Length of the draft content in characters — helps tune the autosave debounce. */
    content_length: number;
  };
  "output.version_saved": {
    case_id: string;
    output_id: string;
    /** New version number after the save. */
    version: number;
  };
  "output.approved": {
    case_id: string;
    /** The output id that was approved (post-flush, may be a fresh row). */
    output_id: string;
    /** True when the approve had to flush a pending draft as v(N+1) first. */
    draft_flushed: boolean;
  };
  "package.exported": {
    case_id: string;
    package_id: string;
    /** PDF byte size — bucket in the dashboard. */
    size_bytes: number;
  };
  "search.performed": {
    /** Length only — never the query string itself, which can carry PII. */
    query_length: number;
    case_results: number;
    document_results: number;
  };
  "admin.attorney_status_changed": {
    target_attorney_id: string;
    from_status: AttorneyStatus;
    to_status: AttorneyStatus;
  };
  "admin.case_reassigned": {
    case_id: string;
    from_attorney_id: string;
    to_attorney_id: string;
  };
};

/** Discriminated union of every legal event-payload pair. */
export type AnalyticsEvent = {
  [N in EventName]: { name: N; properties: EventPayloads[N] };
}[EventName];

/**
 * Property-key denylist enforced at emit time by the analytics
 * wrappers. Mirrors `lib/sentry-scrub.ts` so the two pipelines never
 * disagree on what counts as PII. snake_case + camelCase variants are
 * both checked.
 */
export const PII_PROPERTY_KEYS: ReadonlyArray<string> = [
  "email",
  "full_name",
  "fullName",
  "beneficiary_name",
  "beneficiaryName",
  "extracted_text",
  "extractedText",
  "content",
  "name",
];

/** True when any top-level key on `payload` is in the PII denylist.
 *  Used by the runtime audit — caller decides whether to throw (dev) or
 *  silently drop the event (prod).
 *
 *  Scans only enumerable own keys via `Object.keys()`. All event
 *  payloads are plain object literals built at the call site, so
 *  inherited / non-enumerable keys cannot reach this function — the
 *  discriminated-union type in `EventPayloads` enforces that shape at
 *  compile time. */
export function payloadHasPii(payload: Record<string, unknown>): boolean {
  for (const key of Object.keys(payload)) {
    if (PII_PROPERTY_KEYS.includes(key)) return true;
  }
  return false;
}
