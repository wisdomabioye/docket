/**
 * Organization slug generation. Pure functions, separated from
 * `onboarding.ts` so they can be unit-tested without a DB.
 *
 * `slugBase`: deterministic, derived from the user's email-username.
 * `randomSuffix`: 6-char base36 (~2 billion options) — collision rate
 * 1 in 2.1B per pair, so retry-on-collision is the right strategy.
 */

const MAX_BASE_LENGTH = 32;
const SUFFIX_LENGTH = 6;
const FALLBACK_BASE = "user";

export function slugBase(email: string): string {
  const local = (email.split("@")[0] ?? FALLBACK_BASE)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_BASE_LENGTH);
  return local || FALLBACK_BASE;
}

export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 2 + SUFFIX_LENGTH);
}
