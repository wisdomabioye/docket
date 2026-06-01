import { describe, expect, it } from "vitest";
import {
  RECOMMENDER_LETTER_DRAFT_BADGE,
  RECOMMENDER_LETTER_DRAFT_CONSEQUENCE,
  RECOMMENDER_LETTER_HINT,
  RECOMMENDER_LETTER_WATERMARK,
  recommenderLetterInstruction,
} from "@/lib/recommender-letter";

describe("recommender-letter copy", () => {
  it("the consequence references the EXACT watermark + badge tokens (no drift)", () => {
    // The copy must name the same strings the PDF actually stamps —
    // that's the whole point of sharing them.
    expect(RECOMMENDER_LETTER_DRAFT_CONSEQUENCE).toContain(
      RECOMMENDER_LETTER_WATERMARK,
    );
    expect(RECOMMENDER_LETTER_DRAFT_CONSEQUENCE).toContain(
      RECOMMENDER_LETTER_DRAFT_BADGE,
    );
  });

  it("the hint states the loop: email → sign → upload", () => {
    expect(RECOMMENDER_LETTER_HINT).toMatch(/email/i);
    expect(RECOMMENDER_LETTER_HINT).toMatch(/sign/i);
    expect(RECOMMENDER_LETTER_HINT).toMatch(/upload/i);
  });

  describe("recommenderLetterInstruction", () => {
    it("personalizes with the recommender name when given", () => {
      const out = recommenderLetterInstruction("Dr. Helena Vance");
      expect(out).toContain("Dr. Helena Vance");
      expect(out).toMatch(/email/i);
      expect(out).toMatch(/upload/i);
      expect(out).toContain(RECOMMENDER_LETTER_WATERMARK);
    });

    it("falls back to 'the recommender' when name is missing", () => {
      expect(recommenderLetterInstruction()).toContain("the recommender");
      expect(recommenderLetterInstruction(null)).toContain("the recommender");
    });

    it("treats a whitespace-only name as missing", () => {
      expect(recommenderLetterInstruction("   ")).toContain("the recommender");
    });
  });
});
