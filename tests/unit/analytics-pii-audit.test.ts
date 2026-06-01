// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  type AnalyticsEvent,
  type EventName,
  EVENT_NAMES,
  PII_PROPERTY_KEYS,
  payloadHasPii,
} from "@/lib/analytics/events";
import {
  sanitizeProperties,
  scrubUrlPii,
} from "@/lib/analytics/sanitize";

/**
 * Static PII audit. Catches drift between the typed taxonomy and the
 * PII denylist BEFORE a bad event ships to production. The runtime
 * guard (`pii-guard.ts`) only fires if the bad event is actually
 * emitted at least once; this test catches the same shape at CI.
 *
 * The fixture below is the test's "source of truth": one canonical
 * sample payload per event name. Adding a new event to the taxonomy
 * forces a new entry here (the `Record<EventName, AnalyticsEvent>`
 * type makes TS reject incomplete fixtures), and that new entry then
 * gets walked against the denylist by the assertion below.
 *
 * If you're adding a new event:
 *   1. Add it to `EVENT_NAMES` + `EventPayloads` in
 *      `lib/analytics/events.ts`.
 *   2. Add a sample payload below — TS won't compile this test until
 *      you do.
 *   3. The assertion runs automatically and rejects any PII keys in
 *      your sample.
 */

const SAMPLE_EVENT_PAYLOADS: Record<EventName, AnalyticsEvent> = {
  "auth.signed_in": {
    name: "auth.signed_in",
    properties: { provider: "google", is_new_user: true },
  },
  "attorney.onboarded": {
    name: "attorney.onboarded",
    properties: { attorney_id: "user-uuid-1" },
  },
  "attorney.activated": {
    name: "attorney.activated",
    properties: { attorney_id: "user-uuid-1" },
  },
  "signature.signed": {
    name: "signature.signed",
    properties: {
      signature_id: "sig-uuid-1",
      document_kind: "contractor_agreement",
      document_version: "v1",
    },
  },
  "case.created": {
    name: "case.created",
    properties: { case_id: "case-uuid-1", visa_type: "O-1A" },
  },
  "case.intake_submitted": {
    name: "case.intake_submitted",
    properties: {
      case_id: "case-uuid-1",
      visa_type: "EB-1A",
      field_count: 12,
    },
  },
  "case.build_requested": {
    name: "case.build_requested",
    properties: {
      case_id: "case-uuid-1",
      visa_type: "O-1A",
      document_count: 8,
    },
  },
  "case.archived": {
    name: "case.archived",
    properties: { case_id: "case-uuid-1", prior_status: "draft_ready" },
  },
  "case.lifecycle_transition": {
    name: "case.lifecycle_transition",
    properties: {
      case_id: "case-uuid-1",
      from_status: "approved",
      to_status: "delivered",
      trigger: "package_delivered",
    },
  },
  "document.uploaded": {
    name: "document.uploaded",
    properties: {
      case_id: "case-uuid-1",
      document_id: "doc-uuid-1",
      document_type: "publication",
      size_bytes: 524288,
      mime_type: "application/pdf",
    },
  },
  "document.deleted": {
    name: "document.deleted",
    properties: { case_id: "case-uuid-1", document_id: "doc-uuid-1" },
  },
  "recommender.added": {
    name: "recommender.added",
    properties: { case_id: "case-uuid-1", recommender_id: "rec-uuid-1" },
  },
  "recommender.removed": {
    name: "recommender.removed",
    properties: { case_id: "case-uuid-1", recommender_id: "rec-uuid-1" },
  },
  "output.viewed": {
    name: "output.viewed",
    properties: {
      case_id: "case-uuid-1",
      output_id: "output-uuid-1",
      output_type: "personal_statement",
      version: 3,
    },
  },
  "output.draft_saved": {
    name: "output.draft_saved",
    properties: {
      case_id: "case-uuid-1",
      output_id: "output-uuid-1",
      content_length: 4321,
    },
  },
  "output.version_saved": {
    name: "output.version_saved",
    properties: {
      case_id: "case-uuid-1",
      output_id: "output-uuid-1",
      version: 4,
    },
  },
  "output.approved": {
    name: "output.approved",
    properties: {
      case_id: "case-uuid-1",
      output_id: "output-uuid-1",
      draft_flushed: true,
    },
  },
  "package.exported": {
    name: "package.exported",
    properties: {
      case_id: "case-uuid-1",
      package_id: "cases/case-uuid-1/pdf/package-1700000000000.pdf",
      size_bytes: 1048576,
    },
  },
  "search.performed": {
    name: "search.performed",
    properties: { query_length: 5, case_results: 2, document_results: 1 },
  },
  "admin.attorney_status_changed": {
    name: "admin.attorney_status_changed",
    properties: {
      target_attorney_id: "user-uuid-2",
      from_status: "pending",
      to_status: "active",
    },
  },
  "admin.case_reassigned": {
    name: "admin.case_reassigned",
    properties: {
      case_id: "case-uuid-1",
      from_attorney_id: "user-uuid-1",
      to_attorney_id: "user-uuid-2",
    },
  },
};

describe("analytics taxonomy — PII denylist audit", () => {
  it("every declared event name has a sample fixture", () => {
    // The `Record<EventName, ...>` type makes TS reject missing
    // entries at compile time, but this runtime check is a friendly
    // backstop in case the type relationship ever loosens.
    for (const name of EVENT_NAMES) {
      expect(SAMPLE_EVENT_PAYLOADS[name]).toBeDefined();
    }
  });

  it("no fixture payload contains a PII property key", () => {
    for (const name of EVENT_NAMES) {
      const event = SAMPLE_EVENT_PAYLOADS[name];
      const properties = event.properties as unknown as Record<
        string,
        unknown
      >;
      for (const key of Object.keys(properties)) {
        expect(
          PII_PROPERTY_KEYS.includes(key),
          `Event "${name}" declares PII property key "${key}". ` +
            `Either rename the property or remove it from PII_PROPERTY_KEYS.`,
        ).toBe(false);
      }
      // Cross-check: payloadHasPii should agree.
      expect(payloadHasPii(properties)).toBe(false);
    }
  });
});

describe("analytics sanitize — sanitizeProperties", () => {
  it("redacts top-level PII keys with [redacted]", () => {
    const out = sanitizeProperties({
      case_id: "abc",
      email: "leaked@example.com",
    });
    expect(out.case_id).toBe("abc");
    expect(out.email).toBe("[redacted]");
  });

  it("does not mutate the input properties bag", () => {
    const input = { case_id: "abc", email: "leaked@example.com" };
    sanitizeProperties(input);
    expect(input.email).toBe("leaked@example.com");
  });

  it("scrubs URL query params on `$current_url`", () => {
    const out = sanitizeProperties({
      $current_url: "https://trydocketapp.com/cases/abc?email=foo@bar.com",
    });
    expect(out.$current_url).toBe(
      "https://trydocketapp.com/cases/abc?email=%5Bredacted%5D",
    );
  });

  it("leaves non-PII URL params alone", () => {
    const out = sanitizeProperties({
      $current_url: "/case/abc?tab=outputs&filter=approved",
    });
    expect(out.$current_url).toBe("/case/abc?tab=outputs&filter=approved");
  });

  it("leaves non-string values on URL keys untouched", () => {
    const out = sanitizeProperties({
      $current_url: null,
      $referrer: undefined,
    });
    expect(out.$current_url).toBeNull();
    expect(out.$referrer).toBeUndefined();
  });

  it("handles malformed URLs by passing the original value through", () => {
    const out = scrubUrlPii("not a url at all but has a ? in it");
    // Returns the original; never throws.
    expect(typeof out).toBe("string");
  });

  it("preserves the relative URL shape (no protocol injected)", () => {
    const out = scrubUrlPii("/case/abc?email=foo");
    expect(out).toBe("/case/abc?email=%5Bredacted%5D");
  });
});
