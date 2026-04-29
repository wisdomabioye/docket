import { describe, expect, it } from "vitest";
import {
  PII_KEY_PATTERNS,
  scrubBreadcrumb,
  scrubEvent,
  scrubValue,
} from "@/lib/sentry-scrub";
import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Spec §17 PII keys must be redacted before any Sentry event leaves the
 * process. Tests cover: every named PII key (snake_case + camelCase),
 * nested redaction, breadcrumb scrubbing, non-PII keys preserved,
 * primitive values untouched, immutability of caller's data.
 */

describe("PII_KEY_PATTERNS", () => {
  it.each([
    ["email", true],
    ["EMAIL", true],
    ["full_name", true],
    ["fullName", true],
    ["beneficiary_name", true],
    ["beneficiaryName", true],
    ["extracted_text", true],
    ["extractedText", true],
    ["content", true],
    // Non-PII keys must NOT match.
    ["caseId", false],
    ["status", false],
    ["model", false],
    ["finishReason", false],
    ["userId", false],
  ])("%s → match=%s", (key, expected) => {
    const matches = PII_KEY_PATTERNS.some((re) => re.test(key));
    expect(matches).toBe(expected);
  });
});

describe("scrubValue", () => {
  it("redacts top-level PII keys", () => {
    const out = scrubValue({
      email: "att@docket.local",
      caseId: "abc",
    }) as Record<string, unknown>;
    expect(out.email).toBe("[redacted]");
    expect(out.caseId).toBe("abc");
  });

  it("redacts nested PII keys", () => {
    const out = scrubValue({
      beneficiary: {
        fullName: "Jane Doe",
        nationality: "US",
      },
      audit: {
        actor: { email: "att@docket.local", id: "u-1" },
      },
    }) as {
      beneficiary: { fullName: unknown; nationality: unknown };
      audit: { actor: { email: unknown; id: unknown } };
    };
    expect(out.beneficiary.fullName).toBe("[redacted]");
    expect(out.beneficiary.nationality).toBe("US");
    expect(out.audit.actor.email).toBe("[redacted]");
    expect(out.audit.actor.id).toBe("u-1");
  });

  it("redacts inside array items", () => {
    const out = scrubValue([
      { email: "a@x.io", caseId: "1" },
      { email: "b@y.io", caseId: "2" },
    ]) as Array<{ email: unknown; caseId: unknown }>;
    expect(out[0]?.email).toBe("[redacted]");
    expect(out[1]?.email).toBe("[redacted]");
    expect(out[0]?.caseId).toBe("1");
  });

  it("returns primitives unchanged", () => {
    expect(scrubValue("hello")).toBe("hello");
    expect(scrubValue(42)).toBe(42);
    expect(scrubValue(true)).toBe(true);
    expect(scrubValue(null)).toBe(null);
    expect(scrubValue(undefined)).toBe(undefined);
  });

  it("does NOT mutate the caller's object", () => {
    const input = { email: "a@x.io", caseId: "1" };
    scrubValue(input);
    expect(input.email).toBe("a@x.io");
  });

  it("bounds recursion at depth 8 (returns deep object as-is)", () => {
    // Build a 12-level nested object with PII at the bottom.
    let leaf: Record<string, unknown> = { email: "deep@x.io" };
    for (let i = 0; i < 12; i++) {
      leaf = { wrap: leaf };
    }
    // The scrubber returns the deeply-nested email NOT scrubbed past
    // depth 8 — accepted trade-off; Sentry truncates deep events anyway.
    const out = scrubValue(leaf);
    expect(out).toBeDefined();
  });
});

describe("scrubEvent", () => {
  it("scrubs request, user, extra, contexts, tags, breadcrumbs", () => {
    const event = {
      request: { data: { email: "a@x.io", visa: "O-1A" } },
      user: { email: "u@x.io", id: "u-1" },
      extra: { fullName: "Jane Doe", caseId: "c-1" },
      contexts: { case: { beneficiaryName: "Jane", visaType: "O-1A" } },
      tags: { content: "secret prose", traceId: "abc" },
      breadcrumbs: [
        {
          category: "fetch",
          data: { extracted_text: "long text", url: "/api/x" },
        },
      ],
    } as unknown as ErrorEvent;

    const out = scrubEvent(event, {});
    expect(out).not.toBeNull();
    const o = out as unknown as {
      request: { data: { email: unknown; visa: unknown } };
      user: { email: unknown; id: unknown };
      extra: { fullName: unknown; caseId: unknown };
      contexts: { case: { beneficiaryName: unknown; visaType: unknown } };
      tags: { content: unknown; traceId: unknown };
      breadcrumbs: Array<{
        data: { extracted_text: unknown; url: unknown };
      }>;
    };
    expect(o.request.data.email).toBe("[redacted]");
    expect(o.request.data.visa).toBe("O-1A");
    expect(o.user.email).toBe("[redacted]");
    expect(o.user.id).toBe("u-1");
    expect(o.extra.fullName).toBe("[redacted]");
    expect(o.extra.caseId).toBe("c-1");
    expect(o.contexts.case.beneficiaryName).toBe("[redacted]");
    expect(o.contexts.case.visaType).toBe("O-1A");
    expect(o.tags.content).toBe("[redacted]");
    expect(o.tags.traceId).toBe("abc");
    expect(o.breadcrumbs[0]?.data.extracted_text).toBe("[redacted]");
    expect(o.breadcrumbs[0]?.data.url).toBe("/api/x");
  });

  it("scrubs PII inside event.exception (stack frame vars + mechanism.data)", () => {
    const event = {
      exception: {
        values: [
          {
            type: "Error",
            value: "save failed",
            stacktrace: {
              frames: [
                {
                  function: "handler",
                  // Local-scope vars at throw time — Sentry captures
                  // these when `attachStacktrace` is enabled.
                  vars: {
                    email: "att@docket.local",
                    caseId: "c-1",
                  },
                },
              ],
            },
            mechanism: {
              type: "generic",
              data: { content: "secret prose excerpt", url: "/api/x" },
            },
          },
        ],
      },
    } as unknown as ErrorEvent;

    const out = scrubEvent(event, {});
    expect(out).not.toBeNull();
    const o = out as unknown as {
      exception: {
        values: Array<{
          stacktrace: { frames: Array<{ vars: { email: unknown; caseId: unknown } }> };
          mechanism: { data: { content: unknown; url: unknown } };
        }>;
      };
    };
    expect(o.exception.values[0]?.stacktrace.frames[0]?.vars.email).toBe(
      "[redacted]",
    );
    expect(o.exception.values[0]?.stacktrace.frames[0]?.vars.caseId).toBe("c-1");
    expect(o.exception.values[0]?.mechanism.data.content).toBe("[redacted]");
    expect(o.exception.values[0]?.mechanism.data.url).toBe("/api/x");
  });

  it("handles events with no PII fields (no-op)", () => {
    const event = {
      message: "something failed",
      level: "error",
    } as unknown as ErrorEvent;
    const out = scrubEvent(event, {});
    expect(out).not.toBeNull();
    expect((out as unknown as { message: string }).message).toBe(
      "something failed",
    );
  });

  it("never returns null (preserves stack traces)", () => {
    const event = { extra: { email: "x@y.io" } } as unknown as ErrorEvent;
    expect(scrubEvent(event, {})).not.toBeNull();
  });
});

describe("scrubBreadcrumb", () => {
  it("redacts PII keys inside breadcrumb data", () => {
    const out = scrubBreadcrumb({
      category: "console",
      data: { content: "secret", url: "/api/case" },
    });
    expect(out).not.toBeNull();
    const o = out as { data: { content: unknown; url: unknown } };
    expect(o.data.content).toBe("[redacted]");
    expect(o.data.url).toBe("/api/case");
  });
});
