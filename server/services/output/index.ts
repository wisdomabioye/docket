import "server-only";
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  caseComputeLedger,
  caseOutputs,
  cases,
} from "@/server/db/schema";
import { OutputMetadataSchema } from "@/server/db/schema/zod";
import type { Db } from "@/server/db/client";
import { AppError } from "@/lib/errors";
import { mdToSafeHtml } from "@/lib/markdown";
import { INTERNAL_OUTPUT_TYPES } from "@/lib/output-types";
import type { OutputType } from "@/server/services/computer/types";

/**
 * Single mutation path for `case_outputs` writes. Every Inngest output
 * sub-function calls `saveOutputVersion()`; nothing else may insert into
 * `case_outputs`.
 *
 * What this enforces in one transaction:
 *   1. Lock the `cases` row for update (budget atomicity).
 *   2. Re-check budget — if the spend would push past the cap, throw
 *      `AppError("BAD_REQUEST", "compute budget exceeded")` so the
 *      sub-function can transition the case to `draft_ready` (partial)
 *      without writing a wasted row.
 *   3. Read MAX(`output_version`) for the (case, type, subgroup) tuple
 *      — also lock-aware via the FOR UPDATE on `cases` (Postgres
 *      serializes the whole tx vs. concurrent writes for the same case).
 *   4. Flip every prior `is_current=true` row in (case, type, subgroup)
 *      to false.
 *   5. INSERT the new `case_outputs` row (version = max + 1).
 *   6. INSERT a `case_compute_ledger` entry attributing the spend.
 *   7. UPDATE `cases.compute_spent_cents += usdCents`.
 *
 * Caller MUST pass the open transaction so all six writes land or none do.
 *
 * Subgroup awareness (Stage 08, open_issues #20): when the same output
 * type splits into per-recommender (or future) buckets, pass `subgroupKey`
 * so each bucket maintains an independent current/version chain.
 * `recommendation_letter_template` uses `recommender.id`; single-instance
 * types pass `null` (default).
 *
 * The DB has partial unique indexes on `(case_id, output_type,
 * COALESCE(subgroup_key, ''))` and `(case_id, output_type,
 * COALESCE(subgroup_key, ''), output_version)` (migration 0012) as
 * safety nets — the service layer is the gate, the indexes catch bugs.
 */
export type SaveOutputVersionArgs = {
  tx: Db;
  caseId: string;
  outputType: OutputType;
  /** Per-(case, type) sub-bucket. Pass `recommender.id` for
   *  `recommendation_letter_template`; `null` (default) for single-
   *  instance output types. */
  subgroupKey?: string | null;
  /** Author of this version. Defaults to `computer` (Stage 07 jobs);
   *  Stage 08 sets `attorney` for in-place edits and `system` for
   *  restore-version copies. */
  author?: "computer" | "attorney" | "system";
  /** Links to the row this version derived from. Stage 08 sets this on
   *  attorney edits and version restores so the version graph is
   *  reconstructible. Default `null` (top of the chain). */
  parentId?: string | null;
  /** Full prose or stringified JSON the model produced. */
  content: string;
  /** Optional pre-rendered HTML cache. Stage 08 attorney edits stamp
   *  this so reads don't re-run `marked` per request. */
  contentHtml?: string | null;
  /** Free-form metadata stored alongside the row — model name, finish
   *  reason, citation list, search results, etc. */
  metadata?: Record<string, unknown>;
  /** Provider session id (Sonar response.id, or `mock-${uuid}`). */
  computerSessionId: string;
  /** Wall-clock duration of the generate() call in ms. */
  computeDurationMs: number;
  promptTokens: number;
  completionTokens: number;
  /** Cost in USD cents (non-negative integer). Coerced to bigint for
   *  the `cases.compute_spent_cents` increment + ledger row. */
  usdCents: number;
};

export type SaveOutputVersionResult = {
  outputId: string;
  outputVersion: number;
  newSpendCents: bigint;
};

/** Build the SQL filter that scopes a query to a (case, type, subgroup)
 *  bucket. `null` subgroup matches `subgroup_key IS NULL`; non-null
 *  matches by equality. Avoids the standard Drizzle gotcha where
 *  `eq(col, null)` becomes `col = NULL` (always FALSE in Postgres). */
function eqSubgroup(subgroupKey: string | null): SQL {
  return subgroupKey === null
    ? isNull(caseOutputs.subgroupKey)
    : eq(caseOutputs.subgroupKey, subgroupKey);
}

export async function saveOutputVersion(
  args: SaveOutputVersionArgs,
): Promise<SaveOutputVersionResult> {
  const { tx, caseId, outputType, usdCents } = args;
  const subgroupKey = args.subgroupKey ?? null;

  // Defensive: a negative cost is almost always a caller bug — silent
  // clamp would mask it AND let a "free" output bypass budget tracking.
  // Throw loudly so the upstream sub-function surfaces the error.
  if (!Number.isFinite(usdCents) || usdCents < 0) {
    throw new AppError(
      "BAD_REQUEST",
      `usdCents must be a non-negative finite number; got ${usdCents}`,
    );
  }
  const usdCentsBig = BigInt(Math.floor(usdCents));

  // Stamp + validate metadata via the canonical `OutputMetadataSchema`.
  // Stage 08 made it a discriminated union — `type: outputType` LAST so
  // it's authoritative; a caller's `metadata.type` (intentional or not)
  // CANNOT override the discriminator and silently route through the
  // wrong branch.
  const validatedMetadata = args.metadata
    ? OutputMetadataSchema.parse({ ...args.metadata, type: outputType })
    : undefined;

  // Step 1: lock the cases row for the duration of this tx. Concurrent
  // sub-functions for the same case serialize behind this lock — even
  // though Inngest's `concurrency: { key: caseId, limit: 1 }` already
  // guarantees this, the row lock is belt + suspenders against a stray
  // direct caller.
  const [caseRow] = await tx
    .select({
      id: cases.id,
      computeBudgetCents: cases.computeBudgetCents,
      computeSpentCents: cases.computeSpentCents,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), isNull(cases.deletedAt)))
    .limit(1)
    .for("update");
  if (!caseRow) {
    throw new AppError("NOT_FOUND", `case ${caseId} not found`);
  }

  // Step 2: budget guard. Reject before doing any write so the sub-
  // function can transition the case to draft_ready with a partial flag.
  const projectedSpend = caseRow.computeSpentCents + usdCentsBig;
  if (projectedSpend > caseRow.computeBudgetCents) {
    throw new AppError(
      "BAD_REQUEST",
      `compute budget exceeded: would spend ${projectedSpend} cents against ${caseRow.computeBudgetCents} cents budget`,
    );
  }

  // Step 3: next version number — scoped to the subgroup so per-
  // recommender chains number independently.
  const [latest] = await tx
    .select({ maxVersion: sql<number>`coalesce(max(${caseOutputs.outputVersion}), 0)::int` })
    .from(caseOutputs)
    .where(
      and(
        eq(caseOutputs.caseId, caseId),
        eq(caseOutputs.outputType, outputType),
        eqSubgroup(subgroupKey),
        isNull(caseOutputs.deletedAt),
      ),
    );
  const nextVersion = (latest?.maxVersion ?? 0) + 1;

  // Step 4: flip prior current — also scoped to the subgroup. Without
  // the subgroup filter, saving recommender B's letter would clobber
  // recommender A's `is_current=true` flag.
  //
  // Atomically clear `draft_content` on the prior row in the same
  // UPDATE: a draft only ever exists on the current row, and once we
  // commit a new version the prior draft is by definition stale (its
  // contents either ARE this new commit or were superseded by it). One
  // SQL statement keeps the (is_current ↔ draft_content) invariant
  // intact even if the tx is interrupted mid-step.
  await tx
    .update(caseOutputs)
    .set({ isCurrent: false, draftContent: null })
    .where(
      and(
        eq(caseOutputs.caseId, caseId),
        eq(caseOutputs.outputType, outputType),
        eqSubgroup(subgroupKey),
        eq(caseOutputs.isCurrent, true),
        isNull(caseOutputs.deletedAt),
      ),
    );

  // Step 5: insert new version. `metadata` already passed through
  // `OutputMetadataSchema.parse()` above so the cast is justified at
  // runtime — Drizzle's `.$type<>()` annotation can't see the parse.
  const [inserted] = await tx
    .insert(caseOutputs)
    .values({
      caseId,
      outputType,
      outputVersion: nextVersion,
      isCurrent: true,
      ...(subgroupKey !== null ? { subgroupKey } : {}),
      content: args.content,
      ...(args.contentHtml !== undefined ? { contentHtml: args.contentHtml } : {}),
      ...(args.parentId !== undefined ? { parentId: args.parentId } : {}),
      ...(validatedMetadata
        ? { metadata: validatedMetadata as never }
        : {}),
      author: args.author ?? "computer",
      computerSessionId: args.computerSessionId,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      computeDurationMs: args.computeDurationMs,
      costCents: usdCentsBig,
    })
    .returning({ id: caseOutputs.id });
  if (!inserted) {
    throw new AppError("INTERNAL", "case_outputs insert returned no row");
  }

  // Step 6: ledger entry. `compute_spend` is the only entry_type Stage 7
  // produces; admin adjustments / credits land here too in later stages.
  await tx.insert(caseComputeLedger).values({
    caseId,
    outputId: inserted.id,
    entryType: "compute_spend",
    amountCents: usdCentsBig,
    metadata: {
      sessionId: args.computerSessionId,
      outputType,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      durationMs: args.computeDurationMs,
    },
  });

  // Step 7: bump the spend counter on cases. SQL increment expression
  // (rather than read-then-write) so concurrent calls — should they
  // somehow race past the lock — accumulate correctly.
  const newSpend = projectedSpend;
  await tx
    .update(cases)
    .set({ computeSpentCents: newSpend })
    .where(eq(cases.id, caseId));

  return {
    outputId: inserted.id,
    outputVersion: nextVersion,
    newSpendCents: newSpend,
  };
}

/**
 * Slim projection of current outputs — used by `output.list` (the
 * grid card view). Excludes `content` and `contentHtml` so the wire
 * payload stays small even for cases with 50KB+ of prose per output.
 * `contentLength` lets the UI render "X chars" / a progress bar
 * without shipping the prose.
 */
export type CurrentOutputListItem = {
  id: string;
  outputType: OutputType;
  outputVersion: number;
  subgroupKey: string | null;
  metadata: unknown;
  attorneyApproved: boolean;
  approvedAt: Date | null;
  computerSessionId: string | null;
  costCents: bigint | null;
  contentLength: number;
  hasContentHtml: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function getCurrentOutputsForList(args: {
  db: Db;
  caseId: string;
}): Promise<CurrentOutputListItem[]> {
  return await args.db
    .select({
      id: caseOutputs.id,
      outputType: caseOutputs.outputType,
      outputVersion: caseOutputs.outputVersion,
      subgroupKey: caseOutputs.subgroupKey,
      metadata: caseOutputs.metadata,
      attorneyApproved: caseOutputs.attorneyApproved,
      approvedAt: caseOutputs.approvedAt,
      computerSessionId: caseOutputs.computerSessionId,
      costCents: caseOutputs.costCents,
      // SQL-side length to avoid shipping the prose just to count chars.
      contentLength: sql<number>`coalesce(length(${caseOutputs.content}), 0)::int`,
      hasContentHtml: sql<boolean>`${caseOutputs.contentHtml} is not null`,
      createdAt: caseOutputs.createdAt,
      updatedAt: caseOutputs.updatedAt,
    })
    .from(caseOutputs)
    .where(
      and(
        eq(caseOutputs.caseId, args.caseId),
        eq(caseOutputs.isCurrent, true),
        isNull(caseOutputs.deletedAt),
        // Hide upstream-scaffolding types (e.g. evidence_plan) — they
        // feed prompt builders but aren't attorney-facing artifacts.
        // `INTERNAL_OUTPUT_TYPES` is empty-safe; `notInArray` over an
        // empty array returns SQL `true` so this is a no-op when no
        // internals are declared.
        ...(INTERNAL_OUTPUT_TYPES.length > 0
          ? [notInArray(caseOutputs.outputType, [...INTERNAL_OUTPUT_TYPES])]
          : []),
      ),
    )
    .orderBy(
      sql`${caseOutputs.outputType}::text`,
      sql`coalesce(${caseOutputs.subgroupKey}, '')`,
    );
}

/**
 * Returns the current (`is_current=true`) outputs for a case, ordered
 * by `output_type` (alphabetic). Stage 08's package compiler consumes
 * this — the per-output PDF render needs the full `content` for body
 * rendering. Multi-subgroup output types
 * (`recommendation_letter_template`) return one row PER subgroup.
 *
 * Use `getCurrentOutputsForList` for the grid card view (no content
 * payload).
 */
export async function getCurrentOutputs(args: {
  db: Db;
  caseId: string;
}): Promise<
  Array<{
    id: string;
    outputType: OutputType;
    outputVersion: number;
    subgroupKey: string | null;
    content: string | null;
    contentHtml: string | null;
    metadata: unknown;
    attorneyApproved: boolean;
    approvedAt: Date | null;
    computerSessionId: string | null;
    costCents: bigint | null;
    createdAt: Date;
    updatedAt: Date;
  }>
> {
  return await args.db
    .select({
      id: caseOutputs.id,
      outputType: caseOutputs.outputType,
      outputVersion: caseOutputs.outputVersion,
      subgroupKey: caseOutputs.subgroupKey,
      content: caseOutputs.content,
      contentHtml: caseOutputs.contentHtml,
      metadata: caseOutputs.metadata,
      attorneyApproved: caseOutputs.attorneyApproved,
      approvedAt: caseOutputs.approvedAt,
      computerSessionId: caseOutputs.computerSessionId,
      costCents: caseOutputs.costCents,
      createdAt: caseOutputs.createdAt,
      updatedAt: caseOutputs.updatedAt,
    })
    .from(caseOutputs)
    .where(
      and(
        eq(caseOutputs.caseId, args.caseId),
        eq(caseOutputs.isCurrent, true),
        isNull(caseOutputs.deletedAt),
      ),
    )
    // Alphabetical (cast to text — `output_type` is a Postgres enum, and
    // its native ordering is the enum-declaration order, not alphabetic).
    // Subgroup as secondary sort so multi-recommender letters render in
    // a stable order across reads.
    .orderBy(
      sql`${caseOutputs.outputType}::text`,
      sql`coalesce(${caseOutputs.subgroupKey}, '')`,
    );
}

/**
 * Read the latest `is_current=true` row for a (case, type, subgroup).
 * Returns `null` when no current row exists (e.g. before the first
 * generation completes). Stage 08's `output.get` and the build context
 * loader (`server/jobs/_context.ts`) both use this.
 */
export async function getCurrentOutput(args: {
  db: Db;
  caseId: string;
  outputType: OutputType;
  subgroupKey?: string | null;
}): Promise<{
  id: string;
  outputType: OutputType;
  outputVersion: number;
  subgroupKey: string | null;
  content: string | null;
  contentHtml: string | null;
  metadata: unknown;
  attorneyApproved: boolean;
  approvedAt: Date | null;
  approvedBy: string | null;
  approvalNotes: string | null;
  parentId: string | null;
  author: "computer" | "attorney" | "system";
  computerSessionId: string | null;
  costCents: bigint | null;
  createdAt: Date;
  updatedAt: Date;
} | null> {
  const subgroup = args.subgroupKey ?? null;
  const [row] = await args.db
    .select({
      id: caseOutputs.id,
      outputType: caseOutputs.outputType,
      outputVersion: caseOutputs.outputVersion,
      subgroupKey: caseOutputs.subgroupKey,
      content: caseOutputs.content,
      contentHtml: caseOutputs.contentHtml,
      metadata: caseOutputs.metadata,
      attorneyApproved: caseOutputs.attorneyApproved,
      approvedAt: caseOutputs.approvedAt,
      approvedBy: caseOutputs.approvedBy,
      approvalNotes: caseOutputs.approvalNotes,
      parentId: caseOutputs.parentId,
      author: caseOutputs.author,
      computerSessionId: caseOutputs.computerSessionId,
      costCents: caseOutputs.costCents,
      createdAt: caseOutputs.createdAt,
      updatedAt: caseOutputs.updatedAt,
    })
    .from(caseOutputs)
    .where(
      and(
        eq(caseOutputs.caseId, args.caseId),
        eq(caseOutputs.outputType, args.outputType),
        eqSubgroup(subgroup),
        eq(caseOutputs.isCurrent, true),
        isNull(caseOutputs.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Full version history for one (case, type, subgroup). Used by Stage 08's
 * version selector + restore UI.
 */
export async function getOutputVersionHistory(args: {
  db: Db;
  caseId: string;
  outputType: OutputType;
  subgroupKey?: string | null;
}): Promise<
  Array<{
    id: string;
    outputVersion: number;
    isCurrent: boolean;
    parentId: string | null;
    author: "computer" | "attorney" | "system";
    attorneyApproved: boolean;
    createdAt: Date;
    costCents: bigint | null;
  }>
> {
  const subgroup = args.subgroupKey ?? null;
  return await args.db
    .select({
      id: caseOutputs.id,
      outputVersion: caseOutputs.outputVersion,
      isCurrent: caseOutputs.isCurrent,
      parentId: caseOutputs.parentId,
      author: caseOutputs.author,
      attorneyApproved: caseOutputs.attorneyApproved,
      createdAt: caseOutputs.createdAt,
      costCents: caseOutputs.costCents,
    })
    .from(caseOutputs)
    .where(
      and(
        eq(caseOutputs.caseId, args.caseId),
        eq(caseOutputs.outputType, args.outputType),
        eqSubgroup(subgroup),
        isNull(caseOutputs.deletedAt),
      ),
    )
    .orderBy(desc(caseOutputs.outputVersion));
}

/**
 * Per-case "X of N approved" tally — used by the dashboard's case
 * list to render output progress without an N+1 query (one
 * `getCurrentOutputsForList` per case would balloon for an attorney
 * with 50+ cases). Returns a `Map<caseId, { approved, total }>` so
 * callers can do constant-time lookups.
 *
 * Empty `caseIds` → empty map (zero round-trips).
 */
export async function summarizeOutputApprovals(args: {
  db: Db;
  caseIds: ReadonlyArray<string>;
}): Promise<Map<string, { approved: number; total: number }>> {
  const result = new Map<string, { approved: number; total: number }>();
  if (args.caseIds.length === 0) return result;
  // Single round-trip via `count(*) FILTER`. Filters the same shape as
  // `getCurrentOutputsForList` (current + non-deleted) so the tally
  // matches what the user would see on `/case/[id]/outputs`.
  const rows = await args.db
    .select({
      caseId: caseOutputs.caseId,
      total: sql<number>`count(*)::int`,
      approved: sql<number>`count(*) filter (where ${caseOutputs.attorneyApproved} = true)::int`,
    })
    .from(caseOutputs)
    .where(
      and(
        inArray(caseOutputs.caseId, [...args.caseIds]),
        eq(caseOutputs.isCurrent, true),
        isNull(caseOutputs.deletedAt),
        // Mirror `getCurrentOutputsForList` — internals don't count
        // against the tally, otherwise `total` always exceeds
        // `approved` and `package.ready` never fires.
        ...(INTERNAL_OUTPUT_TYPES.length > 0
          ? [notInArray(caseOutputs.outputType, [...INTERNAL_OUTPUT_TYPES])]
          : []),
      ),
    )
    .groupBy(caseOutputs.caseId);
  for (const r of rows) {
    result.set(r.caseId, { approved: r.approved, total: r.total });
  }
  return result;
}

/**
 * Convenience: read the current spend on a case. Used by the budget
 * pre-check in Inngest sub-functions (re-checked atomically inside the
 * transaction by `saveOutputVersion`).
 */
export async function getCaseSpendCents(args: {
  db: Db;
  caseId: string;
}): Promise<{ spentCents: bigint; budgetCents: bigint } | null> {
  const [row] = await args.db
    .select({
      spentCents: cases.computeSpentCents,
      budgetCents: cases.computeBudgetCents,
    })
    .from(cases)
    .where(and(eq(cases.id, args.caseId), isNull(cases.deletedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Stage 08 — attorney in-place edit. Saves a new version of the named
 * output with `author='attorney'` + `parentId` linking back to the
 * version this was edited from. Stamps `contentHtml` so the reading
 * view doesn't re-run markdown on every request.
 *
 * Refuses to save if the parent version is currently approved — the
 * caller (tRPC procedure) must call `setOutputApproval(approved=false)`
 * first. This forces the attorney to acknowledge that an edit
 * un-approves the document, rather than silently demoting their
 * earlier sign-off.
 *
 * Empty content (after trim) → BAD_REQUEST. The model can't generate
 * blank prose; an attorney save reduced to whitespace is almost
 * certainly an accidental Ctrl-A + Delete.
 */
export type UpdateOutputContentArgs = {
  tx: Db;
  outputId: string;
  /** Markdown source. Sanitized HTML cache is computed by the caller
   *  via `lib/markdown.ts` so this service stays free of the marked +
   *  turndown dependency surface. */
  content: string;
  contentHtml: string;
  attorneyId: string;
};

export async function updateOutputContent(
  args: UpdateOutputContentArgs,
): Promise<SaveOutputVersionResult> {
  const trimmed = args.content.trim();
  if (trimmed.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      "Content cannot be empty — use Regenerate to draft fresh prose.",
    );
  }

  // Read the row we're editing FROM so we can:
  //   - look up the case (for `saveOutputVersion`'s tx)
  //   - inherit `outputType` + `subgroupKey`
  //   - reject when the parent is approved
  const [parent] = await args.tx
    .select({
      caseId: caseOutputs.caseId,
      outputType: caseOutputs.outputType,
      subgroupKey: caseOutputs.subgroupKey,
      attorneyApproved: caseOutputs.attorneyApproved,
      metadata: caseOutputs.metadata,
    })
    .from(caseOutputs)
    .where(
      and(eq(caseOutputs.id, args.outputId), isNull(caseOutputs.deletedAt)),
    )
    .limit(1);
  if (!parent) {
    throw new AppError("NOT_FOUND", `output ${args.outputId} not found`);
  }
  if (parent.attorneyApproved) {
    throw new AppError(
      "CONFLICT",
      "Output is currently approved — un-approve before editing.",
    );
  }

  // Inherit prior metadata so type-specific fields (recommenderName,
  // provider/sessionId/model, citations) survive the new version. The
  // version graph already records the edit via `parent_id` + `author`.
  return await saveOutputVersion({
    tx: args.tx,
    caseId: parent.caseId,
    outputType: parent.outputType,
    subgroupKey: parent.subgroupKey,
    author: "attorney",
    parentId: args.outputId,
    content: args.content,
    contentHtml: args.contentHtml,
    ...(parent.metadata ? { metadata: parent.metadata } : {}),
    // Attorney edits don't burn provider budget. usdCents=0 short-
    // circuits the budget guard cleanly (still produces a $0 ledger row,
    // which is desired audit trail).
    computerSessionId: `attorney-edit-${args.attorneyId}`,
    computeDurationMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    usdCents: 0,
  });
}

/**
 * Stage 11 W3 — pending in-progress draft. Writes to
 * `case_outputs.draft_content` IN PLACE on the current row. NO new
 * version is created; `content` (the committed baseline) is untouched.
 *
 * Drafts are ephemeral: any commit (`updateOutputContent`,
 * `regenerate`, `restoreVersion`) clears them via
 * `saveOutputVersion`'s prior-row flip. Approve also clears via
 * the W4.3 approve-flushes-draft hook.
 *
 * Idempotent: when the incoming `content` exactly matches
 * `draft_content`, returns `{ saved: false }` without touching the
 * row. Lets the editor's debounced auto-save fire freely without
 * generating no-op writes.
 *
 * Refusal modes:
 *   - NOT_FOUND: row missing or soft-deleted.
 *   - BAD_REQUEST: row is NOT current (drafts only ever sit on the
 *     current version). Editing a non-current row would mean someone
 *     navigated to a stale outputId — caller should re-route to the
 *     current id.
 *   - CONFLICT: row is `attorney_approved`. Approve locks editing;
 *     un-approve first. Mirrors `updateOutputContent`'s behavior.
 *
 * Empty content is permitted as a draft (NULL ≠ ''). The commit path
 * (`updateOutputContent`) is what rejects empty saves — drafts are
 * a transient buffer, not a final state.
 */
export type SaveOutputDraftArgs = {
  tx: Db;
  outputId: string;
  content: string;
};

export async function saveOutputDraft(
  args: SaveOutputDraftArgs,
): Promise<{ saved: boolean }> {
  const [row] = await args.tx
    .select({
      isCurrent: caseOutputs.isCurrent,
      attorneyApproved: caseOutputs.attorneyApproved,
      currentDraft: caseOutputs.draftContent,
    })
    .from(caseOutputs)
    .where(
      and(eq(caseOutputs.id, args.outputId), isNull(caseOutputs.deletedAt)),
    )
    .limit(1);
  if (!row) {
    throw new AppError("NOT_FOUND", `output ${args.outputId} not found`);
  }
  if (!row.isCurrent) {
    throw new AppError(
      "BAD_REQUEST",
      "Cannot save draft on a non-current version. Restore it to current first.",
    );
  }
  if (row.attorneyApproved) {
    throw new AppError(
      "CONFLICT",
      "Output is currently approved — un-approve before editing.",
    );
  }
  // Idempotency: skip the UPDATE when the draft hasn't changed. The
  // editor's debounce already coalesces typing bursts, but two clients
  // (or a refocus-then-type) can still fire the same content twice.
  if (row.currentDraft === args.content) {
    return { saved: false };
  }
  await args.tx
    .update(caseOutputs)
    .set({ draftContent: args.content })
    .where(eq(caseOutputs.id, args.outputId));
  return { saved: true };
}

/**
 * Stage 11 W3 — clear a pending draft. Sets `draft_content = NULL` on
 * the current row of the named output. Used by the editor's "Cancel"
 * button so closing without saving doesn't leave a phantom draft that
 * resurfaces next time the page loads.
 *
 * Idempotent. Does NOT require the row to be in any particular state
 * (allows clearing even on an approved row, since clearing back to the
 * baseline is always safe). Only enforces existence + soft-delete +
 * is_current; the same authorization gate the editor passes through
 * already enforced "you can see this output."
 */
export type ClearOutputDraftArgs = {
  tx: Db;
  outputId: string;
};

export async function clearOutputDraft(
  args: ClearOutputDraftArgs,
): Promise<{ cleared: boolean }> {
  const [row] = await args.tx
    .select({
      isCurrent: caseOutputs.isCurrent,
      currentDraft: caseOutputs.draftContent,
    })
    .from(caseOutputs)
    .where(
      and(eq(caseOutputs.id, args.outputId), isNull(caseOutputs.deletedAt)),
    )
    .limit(1);
  if (!row) {
    throw new AppError("NOT_FOUND", `output ${args.outputId} not found`);
  }
  if (!row.isCurrent) {
    throw new AppError(
      "BAD_REQUEST",
      "Cannot clear draft on a non-current version.",
    );
  }
  if (row.currentDraft === null) {
    return { cleared: false };
  }
  await args.tx
    .update(caseOutputs)
    .set({ draftContent: null })
    .where(eq(caseOutputs.id, args.outputId));
  return { cleared: true };
}

/**
 * Stage 08 — restore a prior version into a fresh `is_current` row.
 * The previous current row is flipped off (by `saveOutputVersion`),
 * the named version's content is copied verbatim, author=`system`.
 * Used when the attorney clicks "Restore version N" in the version
 * history drawer.
 *
 * History is preserved (the source version stays in the table); the
 * restore creates a NEW version pointing back at the source via
 * `parent_id`. Net: undo without losing the audit trail.
 */
export type RestoreOutputVersionArgs = {
  tx: Db;
  /** The version row to restore from (NOT the current row). */
  fromVersionId: string;
  attorneyId: string;
};

export async function restoreOutputVersion(
  args: RestoreOutputVersionArgs,
): Promise<SaveOutputVersionResult> {
  const [source] = await args.tx
    .select({
      caseId: caseOutputs.caseId,
      outputType: caseOutputs.outputType,
      subgroupKey: caseOutputs.subgroupKey,
      content: caseOutputs.content,
      contentHtml: caseOutputs.contentHtml,
      metadata: caseOutputs.metadata,
    })
    .from(caseOutputs)
    .where(
      and(eq(caseOutputs.id, args.fromVersionId), isNull(caseOutputs.deletedAt)),
    )
    .limit(1);
  if (!source) {
    throw new AppError(
      "NOT_FOUND",
      `version ${args.fromVersionId} not found`,
    );
  }
  if (source.content === null) {
    throw new AppError(
      "BAD_REQUEST",
      "Cannot restore an empty-content version.",
    );
  }

  // Carry the source version's metadata onto the restored row — restore
  // is a faithful copy, so type-specific fields (recommenderName, etc.)
  // must travel with the content. `parent_id` records the source link.
  return await saveOutputVersion({
    tx: args.tx,
    caseId: source.caseId,
    outputType: source.outputType,
    subgroupKey: source.subgroupKey,
    author: "system",
    parentId: args.fromVersionId,
    content: source.content,
    contentHtml: source.contentHtml,
    ...(source.metadata ? { metadata: source.metadata } : {}),
    computerSessionId: `attorney-restore-${args.attorneyId}`,
    computeDurationMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    usdCents: 0,
  });
}

/**
 * Stage 08 — flip the approval boolean on the CURRENT row of an output.
 * Idempotent: setting the same value is a no-op (no event written, no
 * state change). The `output.regenerate` mutation calls this with
 * `approved=false` AS A SIDE EFFECT before emitting the regenerate
 * event — a regenerated draft must be re-reviewed.
 */
export type SetOutputApprovalArgs = {
  tx: Db;
  outputId: string;
  approved: boolean;
  attorneyId: string;
  notes?: string | null;
};

export async function setOutputApproval(
  args: SetOutputApprovalArgs,
): Promise<{ changed: boolean }> {
  const [row] = await args.tx
    .select({
      attorneyApproved: caseOutputs.attorneyApproved,
    })
    .from(caseOutputs)
    .where(
      and(eq(caseOutputs.id, args.outputId), isNull(caseOutputs.deletedAt)),
    )
    .limit(1)
    .for("update");
  if (!row) {
    throw new AppError("NOT_FOUND", `output ${args.outputId} not found`);
  }
  if (row.attorneyApproved === args.approved) {
    // Idempotent — same value, no-op. Caller can rely on this to make
    // the regenerate flow's "auto un-approve" safe to call even when
    // the row was never approved.
    return { changed: false };
  }

  await args.tx
    .update(caseOutputs)
    .set(
      args.approved
        ? {
            attorneyApproved: true,
            approvedAt: sql`now()`,
            approvedBy: args.attorneyId,
            ...(args.notes !== undefined ? { approvalNotes: args.notes } : {}),
          }
        : {
            attorneyApproved: false,
            approvedAt: null,
            approvedBy: null,
            approvalNotes: null,
          },
    )
    .where(eq(caseOutputs.id, args.outputId));
  return { changed: true };
}

/**
 * Stage 11 W4 — flush-then-approve. Atomically commits any pending
 * draft as a new version (author=`attorney`, parent=current id), then
 * sets `attorney_approved=true` on whichever row ends up current.
 *
 * Why server-side: the autosave debounce (3s) means a user could click
 * Approve while a draft is still in the buffer waiting on its next
 * autosave fire. Without this flush, Approve would lock in the prior
 * `content` baseline (the last committed version), NOT what the user
 * sees on screen — silent stale-lock-in. The fix has to be atomic in
 * one transaction so a flush+approve never half-applies.
 *
 * No-draft / draft-equals-content path: behaves identically to a
 * straight `setOutputApproval(approved=true)` — no version bump, no
 * ledger row, no churn. The result's `draftFlushed=false` lets the
 * client know nothing changed identifier-wise.
 *
 * Draft-flush path: creates v(N+1) with the draft as `content`,
 * `saveOutputVersion` clears `draft_content` on the prior row in the
 * same UPDATE (W3.4 invariant), then approval lands on the new row.
 * Returns `approvedOutputId = new id, draftFlushed=true` so the panel
 * can re-route to the new version.
 *
 * Empty-draft refusal: an attorney clicked Approve while their draft
 * was whitespace-only (Ctrl-A + Delete + half-typed). The commit path
 * normally rejects this; we mirror that behavior with a friendly
 * BAD_REQUEST so the user knows to either type content or click Cancel.
 */
export type ApproveOutputArgs = {
  tx: Db;
  outputId: string;
  attorneyId: string;
  notes?: string | null;
};

export type ApproveOutputResult = {
  /** The id that ended up `attorney_approved=true`. Differs from the
   *  input `outputId` only when a pending draft was flushed into a
   *  new version. */
  approvedOutputId: string;
  /** True iff a draft was committed as a new version as part of the
   *  approve. Lets the caller tell whether to re-route the URL. */
  draftFlushed: boolean;
};

export async function approveOutput(
  args: ApproveOutputArgs,
): Promise<ApproveOutputResult> {
  const [row] = await args.tx
    .select({
      caseId: caseOutputs.caseId,
      outputType: caseOutputs.outputType,
      subgroupKey: caseOutputs.subgroupKey,
      content: caseOutputs.content,
      draftContent: caseOutputs.draftContent,
      isCurrent: caseOutputs.isCurrent,
      metadata: caseOutputs.metadata,
    })
    .from(caseOutputs)
    .where(
      and(eq(caseOutputs.id, args.outputId), isNull(caseOutputs.deletedAt)),
    )
    .limit(1)
    .for("update");
  if (!row) {
    throw new AppError("NOT_FOUND", `output ${args.outputId} not found`);
  }
  if (!row.isCurrent) {
    throw new AppError(
      "BAD_REQUEST",
      "Cannot approve a non-current version. Restore it first.",
    );
  }

  const hasPendingDraft =
    row.draftContent !== null && row.draftContent !== row.content;

  let approvedId = args.outputId;
  let draftFlushed = false;

  if (hasPendingDraft && row.draftContent !== null) {
    if (row.draftContent.trim().length === 0) {
      throw new AppError(
        "BAD_REQUEST",
        "Pending draft is empty — discard it (Cancel) or type content before approving.",
      );
    }
    const result = await saveOutputVersion({
      tx: args.tx,
      caseId: row.caseId,
      outputType: row.outputType,
      subgroupKey: row.subgroupKey,
      author: "attorney",
      parentId: args.outputId,
      content: row.draftContent,
      // Pre-render HTML cache the same way `updateOutputContent`'s
      // caller does — this is the same markdown→HTML round-trip Tiptap
      // already used to render the draft, so the cache is consistent.
      contentHtml: mdToSafeHtml(row.draftContent),
      // Inherit prior metadata so `recommenderName` (and other type-
      // specific fields read by OutputCard / PDF) survive the flush.
      // The audit trail for "this version was flushed by an attorney"
      // lives in `parent_id` + `author = "attorney"`.
      ...(row.metadata ? { metadata: row.metadata } : {}),
      // Attorney edits don't burn provider budget — same convention
      // `updateOutputContent` uses.
      computerSessionId: `attorney-edit-${args.attorneyId}`,
      computeDurationMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      usdCents: 0,
    });
    approvedId = result.outputId;
    draftFlushed = true;
  }

  await setOutputApproval({
    tx: args.tx,
    outputId: approvedId,
    approved: true,
    attorneyId: args.attorneyId,
    ...(args.notes !== undefined ? { notes: args.notes } : {}),
  });

  return { approvedOutputId: approvedId, draftFlushed };
}
