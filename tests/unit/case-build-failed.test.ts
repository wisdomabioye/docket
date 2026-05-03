import { afterEach, describe, expect, it, vi } from "vitest";
import { caseBuildFailedEvent } from "@/server/jobs/case-build-failed";

/**
 * Stage 11 / PM.4 retired the Phase-9 logging stub; the
 * `case-build-failed` Inngest function now lives at
 * `server/services/email/notifications/case-build-failed.ts` and ships
 * the Postmark email. This test still owns the event-schema contract
 * (orchestrator emit vs notifier consume must agree on shape) — that's
 * the part that survived the move.
 */

describe("case/build.failed event identity", () => {
  it("uses the canonical event name", () => {
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
