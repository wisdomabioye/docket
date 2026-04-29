import { describe, expect, it } from "vitest";
import { OUTPUT_TYPE_DISPLAY } from "@/lib/output-types";
import { outputTypeEnum } from "@/server/db/schema";

/**
 * `OUTPUT_TYPE_DISPLAY` is a `Record<OutputType, string>` — adding a
 * new enum value forces a compile error here until a label lands.
 * Runtime guard: every value is a non-empty trimmed string (catches
 * accidental empty entries from a careless edit).
 */
describe("OUTPUT_TYPE_DISPLAY", () => {
  it("has a non-empty label for every output_type enum value", () => {
    for (const t of outputTypeEnum.enumValues) {
      const label = OUTPUT_TYPE_DISPLAY[t];
      expect(typeof label).toBe("string");
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it("does not produce duplicate labels (each output is distinct in the UI)", () => {
    const labels = outputTypeEnum.enumValues.map((t) => OUTPUT_TYPE_DISPLAY[t]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
