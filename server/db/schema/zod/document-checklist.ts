import { z } from "zod";

/**
 * Schema for `cases.document_checklist` (jsonb). Linked into Drizzle via
 * `.$type<DocumentChecklist>()`.
 *
 * Phase 1 stub — Stage 06 (document management) populates from per-visa
 * templates.
 */
export const DocumentChecklistItemSchema = z
  .object({
    label: z.string().min(1).max(200),
    required: z.boolean(),
    documentType: z.string().optional(), // matches documentTypeEnum values
    received: z.boolean().default(false),
    documentIds: z.array(z.uuid()).default([]),
  })
  .strict();

export const DocumentChecklistSchema = z
  .object({
    visaType: z.string(),
    items: z.array(DocumentChecklistItemSchema),
  })
  .strict();

export type DocumentChecklistItem = z.infer<typeof DocumentChecklistItemSchema>;
export type DocumentChecklist = z.infer<typeof DocumentChecklistSchema>;
