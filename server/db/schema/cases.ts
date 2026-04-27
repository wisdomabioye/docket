import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  caseParticipantRoleEnum,
  caseStatusEnum,
  documentTypeEnum,
  eventActorTypeEnum,
  extractionStatusEnum,
  ledgerEntryTypeEnum,
  outputAuthorEnum,
  outputTypeEnum,
  revenueStatusEnum,
  visaTypeEnum,
} from "./enums";
import { users } from "./auth";
import { organizations } from "./organizations";

/**
 * Top-level case row. Owner is the organization (multi-attorney firms are
 * a Phase 2 reality but the column lands now). Participants — including the
 * primary attorney — live in `case_participants`, which keeps `cases`
 * stable as participation evolves.
 *
 * Beneficiary identity is stored two ways:
 *   - `beneficiary_data` (jsonb) — Phase 1 attorney enters info on behalf
 *     of an absent applicant. Validated via Zod at the service layer.
 *   - `beneficiary_user_id` (uuid, nullable) — Phase 2 forward-compat for
 *     when the applicant is a real user. No FK index in Phase 1.
 *
 * Money:
 *   - `case_fee_cents`, `docket_share_cents`, `attorney_share_cents` are
 *     bigint to leave headroom past 32-bit ($21M ceiling).
 *   - Compute spend lives in `case_compute_ledger`; aggregate when needed.
 */
export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),

    visaType: visaTypeEnum("visa_type").notNull(),
    status: caseStatusEnum("status").notNull().default("intake"),

    // Beneficiary
    beneficiaryUserId: uuid("beneficiary_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    beneficiaryData: jsonb("beneficiary_data"),

    // AI work products (Zod-typed at the service boundary)
    evidencePlan: jsonb("evidence_plan"),
    criteriaAnalysis: jsonb("criteria_analysis"),
    documentChecklist: jsonb("document_checklist"),

    // Money
    caseFeeCents: bigint("case_fee_cents", { mode: "bigint" }),
    docketShareCents: bigint("docket_share_cents", { mode: "bigint" }),
    attorneyShareCents: bigint("attorney_share_cents", { mode: "bigint" }),
    revenueStatus: revenueStatusEnum("revenue_status")
      .notNull()
      .default("pending"),
    invoiceId: uuid("invoice_id"), // FK added in Stage 10 when `invoices` lands.

    // Workflow
    reviewSlaHours: integer("review_sla_hours").notNull().default(72),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    rowRevision: integer("row_revision").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cases_org_status_idx")
      .on(t.organizationId, t.status)
      .where(sql`${t.deletedAt} is null`),
    index("cases_visa_type_idx").on(t.visaType).where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * Per-case participants. Replaces the original plan's `attorney_id` column.
 * A case might have 2 attorneys + 1 paralegal + 1 applicant — all rows here.
 *
 * One role per `(case, user)` pair; if the same user needs two roles on the
 * same case they probably don't. We can revisit if the constraint bites.
 *
 * RLS reads through this junction: "user X can see case Y if there's a
 * non-removed participant row linking them."
 */
export const caseParticipants = pgTable(
  "case_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: caseParticipantRoleEnum("role").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),

    addedBy: uuid("added_by").references(() => users.id, {
      onDelete: "set null",
    }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("case_participants_case_user_active_uniq")
      .on(t.caseId, t.userId)
      .where(sql`${t.removedAt} is null`),
    index("case_participants_user_idx")
      .on(t.userId)
      .where(sql`${t.removedAt} is null`),
  ],
);

/**
 * Uploaded evidence file metadata. The blob lives in object storage; this
 * row carries pointers + extraction state.
 *
 * `sha256` lets us detect duplicate uploads within a case (and, eventually,
 * cross-case dedup if we move to content-addressed storage).
 *
 * `extractedText` will be moved out-of-row when it gets large (> ~500KB);
 * for Phase 1 it lives here.
 */
export const caseDocuments = pgTable(
  "case_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "set null" }),

    documentType: documentTypeEnum("document_type").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    storagePath: text("storage_path").notNull(),

    extractionStatus: extractionStatusEnum("extraction_status")
      .notNull()
      .default("pending"),
    extractedText: text("extracted_text"),
    extractionError: text("extraction_error"),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),

    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("case_documents_case_idx")
      .on(t.caseId)
      .where(sql`${t.deletedAt} is null`),
    // Within a case, dedup by hash.
    uniqueIndex("case_documents_case_sha_uniq")
      .on(t.caseId, t.sha256)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * AI-generated and attorney-edited content. Versioned: every regenerate or
 * edit creates a new row; only one row per `(case, output_type)` is current.
 *
 * Naming:
 *   - `outputVersion` — the human-meaningful version number (1, 2, 3...).
 *   - `rowRevision`   — optimistic-concurrency token for the current row's
 *     own updates (touched by attorney edits within a single version).
 *
 * `pinned` survives pruning. Stage 11 adds a job that drops unpinned,
 * non-current versions older than N days.
 */
export const caseOutputs = pgTable(
  "case_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),

    outputType: outputTypeEnum("output_type").notNull(),
    outputVersion: integer("output_version").notNull().default(1),
    isCurrent: boolean("is_current").notNull().default(true),
    pinned: boolean("pinned").notNull().default(false),

    title: text("title"),
    content: text("content"), // markdown / rich text. Move to object storage if > 1MB.
    metadata: jsonb("metadata"), // output-type-specific (recommender_name, etc.)

    // Computer attribution
    author: outputAuthorEnum("author").notNull().default("computer"),
    computerSessionId: text("computer_session_id"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    computeDurationMs: integer("compute_duration_ms"),
    costCents: bigint("cost_cents", { mode: "bigint" }),

    rowRevision: integer("row_revision").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // At most one current row per (case, output_type).
    uniqueIndex("case_outputs_current_uniq")
      .on(t.caseId, t.outputType)
      .where(sql`${t.isCurrent} = true and ${t.deletedAt} is null`),
    index("case_outputs_case_type_version_idx").on(
      t.caseId,
      t.outputType,
      t.outputVersion,
    ),
  ],
);

/**
 * Per-case timeline. Append-only — no soft-delete, no updates.
 *
 * `eventType` is plain text + a constants file (`lib/event-types.ts`) so
 * vocabulary can evolve without migrations. `actorType` is enum because
 * it's a small, stable set.
 *
 * Will be partition-by-month in Phase 2 — `(case_id, created_at)` index now
 * keeps that future change mechanical.
 */
export const caseEvents = pgTable(
  "case_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    actorType: eventActorTypeEnum("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("case_events_case_created_idx").on(t.caseId, t.createdAt),
    index("case_events_type_idx").on(t.eventType),
  ],
);

/**
 * Append-only ledger for compute spend (Perplexity Computer). Replaces a
 * hot counter column on `cases`; aggregate `sum(amount_cents)` per case
 * for current spend.
 *
 * Generic shape: `entry_type` enum allows future credits / manual
 * adjustments without a new table.
 */
export const caseComputeLedger = pgTable(
  "case_compute_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    outputId: uuid("output_id").references(() => caseOutputs.id, {
      onDelete: "set null",
    }),
    entryType: ledgerEntryTypeEnum("entry_type").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("usd"),
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("case_compute_ledger_case_idx").on(t.caseId),
    index("case_compute_ledger_occurred_idx").on(t.occurredAt),
  ],
);
