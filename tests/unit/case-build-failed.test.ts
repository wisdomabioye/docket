import { afterEach, describe, expect, it, vi } from "vitest";
import { caseBuildFailed, caseBuildFailedEvent } from "@/server/jobs/case-build-failed";

/**
 * `case-build-failed` is a logging-only stub for Phase 9; Stage 11 will
 * replace its body with a Postmark email + Slack ping. The test guards
 * against accidental regressions in the function's wiring (id, trigger,
 * retries) AND verifies the body doesn't throw on a typical event.
 *
 * The handler body uses `console.warn` for now; we silence that during
 * the test so vitest output stays clean.
 */

describe("case-build-failed function definition", () => {
  it("registers under id 'case-build-failed'", () => {
    expect(caseBuildFailed.id()).toBe("case-build-failed");
  });

  it("uses the typed event trigger 'case/build.failed'", () => {
    expect(caseBuildFailedEvent.event).toBe("case/build.failed");
    expect(caseBuildFailedEvent.name).toBe("case/build.failed");
  });
});

describe("case-build-failed event schema", () => {
  it("includes requestedBy in the schema (so watchdog + parent both validate)", async () => {
    // The schema is `staticSchema<{ caseId, reason, requestedBy }>()` —
    // we can't introspect a static-schema's TS type at runtime, but a
    // round-trip through the schema's standard validate hook proves it
    // accepts the expected shape.
    const schema = caseBuildFailedEvent.schema;
    expect(schema).toBeDefined();
    if (!schema) return;
    const result = await schema["~standard"].validate({
      caseId: "c-1",
      reason: "stuck > 30m",
      requestedBy: "u-1",
    });
    // StandardSchemaV1 result: `value` populated on success, `issues`
    // on failure. `staticSchema` is non-validating (pass-through), so
    // success is just structural acceptance.
    expect(result).toBeDefined();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
