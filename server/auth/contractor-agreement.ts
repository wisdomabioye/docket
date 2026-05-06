import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Frozen contractor agreement v1.
 *
 * The body source-of-truth is `agreements/contractor-v{N}.md`. To bump
 * the version: add a new `contractor-v{N+1}.md`, change the import path
 * here, and update `CONTRACTOR_AGREEMENT_VERSION`. The hash is recomputed
 * at module load and passed through `z.literal` at every signing
 * boundary, so any edit to the on-disk body without a version bump
 * causes the next signing attempt to fail input validation. Existing
 * signatures stay valid against their stored `content_hash`.
 *
 * The body is read with `readFileSync` once at module load — no FS hits
 * per request. `process.cwd()` is the Next.js project root in both dev
 * and Vercel (standalone) runtimes; the `.md` file is included in the
 * serverless trace via `outputFileTracingIncludes` in `next.config.ts`.
 */

export const CONTRACTOR_AGREEMENT_VERSION = "v1" as const;
export type ContractorAgreementVersion = typeof CONTRACTOR_AGREEMENT_VERSION;

export const CONTRACTOR_AGREEMENT_TITLE = "Docket Contractor Agreement";

/** `signed_documents.document_kind` discriminator. Mirrored client-side
 *  in `lib/constants.ts`. */
export const CONTRACTOR_AGREEMENT_KIND = "contractor_agreement" as const;

const BODY_PATH = join(
  process.cwd(),
  "server",
  "auth",
  "agreements",
  "contractor-v1.md",
);

export const CONTRACTOR_AGREEMENT_BODY: string = readFileSync(
  BODY_PATH,
  "utf8",
);

export const CONTRACTOR_AGREEMENT_HASH: string = createHash("sha256")
  .update(CONTRACTOR_AGREEMENT_BODY, "utf8")
  .digest("hex");
