/**
 * Plain TS constants mirroring server-only enum values, so client
 * components can list/iterate them without importing server modules.
 *
 * Per CLAUDE.md §2 stack table — keep in sync with `server/db/schema/enums.ts`.
 * If you add a value there, add it here and rerun tests.
 */

export const VISA_TYPES = [
  "O-1A",
  "O-1B",
  "EB-1A",
  "EB-1B",
  "EB-2-NIW",
  "H-1B-transfer",
  "I-130",
  "N-400",
  "L-1A",
  "L-1B",
  "E-2",
  "TN",
  "other",
] as const;

export type VisaType = (typeof VISA_TYPES)[number];
