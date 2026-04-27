/**
 * Bumping `TERMS_VERSION` re-prompts every attorney to re-accept on their
 * next visit (the onboarding form compares this to
 * `attorneyProfiles.acceptedTermsVersion`). Document the change in
 * `docs/decisions.md`.
 */
export const TERMS_VERSION = "v1" as const;
export type TermsVersion = typeof TERMS_VERSION;
