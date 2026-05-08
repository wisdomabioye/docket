import { z } from "zod";

/**
 * Schema for `case_outputs.content` (text, JSON-encoded) when
 * `output_type = exhibit_index`. Stage 7's prompt builder produces JSON
 * conforming to this shape; the Stage 8 structured editor mutates it
 * directly.
 *
 * Lives in `server/db/schema/zod/` (not `server/services/computer/prompts/`)
 * because the **schema must be importable from client components**
 * (the structured editor in `components/output/ExhibitIndexEditor.tsx`).
 * Files under `server/services/computer/prompts/` carry an
 * `import "server-only"` marker; pulling them into a client bundle
 * would error at build time.
 */
export const ExhibitIndexEntrySchema = z
  .object({
    /** Display label e.g. "Exhibit A". Free-form so attorneys can
     *  retitle ("Exhibit A-1") if their firm convention differs. */
    label: z.string(),
    /** FK to `case_documents.id`. The structured editor treats this
     *  as read-only per row — changing the underlying document is a
     *  remove + re-add, not an in-place mutation. UUID-validated so
     *  bad payloads are rejected at the Zod boundary before the
     *  router's `case_documents` FK lookup hits PG with a parse
     *  error on a non-UUID literal. */
    documentId: z.uuid(),
    /** Display filename. Defaults from `case_documents.original_filename`
     *  when a row is added; editable so the index can show a cleaner
     *  presentation than the upload's original name. */
    filename: z.string(),
    /** One- to two-sentence description of the document for the index. */
    description: z.string(),
    /** Free-text criterion identifiers from the evidence plan that
     *  this exhibit supports. Validated as `string[]`; cross-referencing
     *  against the evidence_plan's criteria is a future enhancement. */
    supportsCriteria: z.array(z.string()),
  })
  .strict();

export const ExhibitIndexSchema = z
  .object({
    entries: z.array(ExhibitIndexEntrySchema),
  })
  .strict();

export type ExhibitIndexEntry = z.infer<typeof ExhibitIndexEntrySchema>;
export type ExhibitIndex = z.infer<typeof ExhibitIndexSchema>;
