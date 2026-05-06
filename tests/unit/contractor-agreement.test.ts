// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CONTRACTOR_AGREEMENT_BODY,
  CONTRACTOR_AGREEMENT_HASH,
  CONTRACTOR_AGREEMENT_KIND,
  CONTRACTOR_AGREEMENT_TITLE,
  CONTRACTOR_AGREEMENT_VERSION,
} from "@/server/auth/contractor-agreement";

describe("contractor agreement constants", () => {
  it("hash matches sha256(body)", () => {
    const expected = createHash("sha256")
      .update(CONTRACTOR_AGREEMENT_BODY, "utf8")
      .digest("hex");
    expect(CONTRACTOR_AGREEMENT_HASH).toBe(expected);
  });

  it("body is non-empty and includes the version header", () => {
    expect(CONTRACTOR_AGREEMENT_BODY.length).toBeGreaterThan(200);
    expect(CONTRACTOR_AGREEMENT_BODY).toContain(
      `**Version:** ${CONTRACTOR_AGREEMENT_VERSION}`,
    );
  });

  it("kind + title are stable literals", () => {
    expect(CONTRACTOR_AGREEMENT_KIND).toBe("contractor_agreement");
    expect(CONTRACTOR_AGREEMENT_TITLE).toBe("Docket Contractor Agreement");
  });
});
