import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  caseComputeLedger,
  caseOutputs,
  cases,
} from "@/server/db/schema";
import { OutputMetadataSchema } from "@/server/db/schema/zod";
import type { Db } from "@/server/db/client";
import { AppError } from "@/lib/errors";
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
 *   3. Read MAX(`output_version`) for the (case, type) pair — also
 *      lock-aware via the FOR UPDATE on `cases` (Postgres serializes the
 *      whole tx vs. concurrent writes for the same case).
 *   4. Flip every prior `is_current=true` row in (case, type) to false.
 *   5. INSERT the new `case_outputs` row (version = max + 1).
 *   6. INSERT a `case_compute_ledger` entry attributing the spend.
 *   7. UPDATE `cases.compute_spent_cents += usdCents`.
 *
 * Caller MUST pass the open transaction so all six writes land or none do.
 *
 * The DB has a partial unique index on `(case_id, output_type, output_version)
 * WHERE deleted_at IS NULL` (Stage 07 migration 0011) as a safety net —
 * the service layer is the gate, the index catches bugs.
 */
export type SaveOutputVersionArgs = {
  tx: Db;
  caseId: string;
  outputType: OutputType;
  /** Full prose or stringified JSON the model produced. */
  content: string;
  /** Optional pre-rendered HTML (Stage 8 polish). null for now. */
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

export async function saveOutputVersion(
  args: SaveOutputVersionArgs,
): Promise<SaveOutputVersionResult> {
  const { tx, caseId, outputType, usdCents } = args;

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
  // The schema is a discriminated union over `type`; stamping `type =
  // outputType` lets the generic-metadata branch (passthrough) accept
  // arbitrary additional fields (model, finishReason, citations, …)
  // while still catching shape errors on the typed branches
  // (recommendation_letter_template, exhibit_index).
  // `type: outputType` LAST so it's authoritative — if a caller's
  // `args.metadata` includes its own `type` key (intentional or not),
  // it CANNOT override the discriminator and silently route the
  // metadata through the wrong branch of `OutputMetadataSchema`.
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

  // Step 3: next version number. Filter on `deleted_at IS NULL` to match
  // the partial unique index — soft-deleted versions can be re-numbered.
  const [latest] = await tx
    .select({ maxVersion: sql<number>`coalesce(max(${caseOutputs.outputVersion}), 0)::int` })
    .from(caseOutputs)
    .where(
      and(
        eq(caseOutputs.caseId, caseId),
        eq(caseOutputs.outputType, outputType),
        isNull(caseOutputs.deletedAt),
      ),
    );
  const nextVersion = (latest?.maxVersion ?? 0) + 1;

  // Step 4: flip prior current. The partial unique on (caseId, type)
  // WHERE is_current=true means we MUST flip before inserting the new
  // is_current=true row, otherwise the unique index rejects the insert.
  await tx
    .update(caseOutputs)
    .set({ isCurrent: false })
    .where(
      and(
        eq(caseOutputs.caseId, caseId),
        eq(caseOutputs.outputType, outputType),
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
      content: args.content,
      ...(validatedMetadata
        ? { metadata: validatedMetadata as never }
        : {}),
      author: "computer",
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
 * Returns the current (`is_current=true`) outputs for a case, ordered
 * by `output_type`. Used by Stage 08's review UI and the package
 * compiler. Single-query convenience over filtering caller-side.
 */
export async function getCurrentOutputs(args: {
  db: Db;
  caseId: string;
}): Promise<
  Array<{
    id: string;
    outputType: OutputType;
    outputVersion: number;
    content: string | null;
    metadata: unknown;
    computerSessionId: string | null;
    costCents: bigint | null;
    createdAt: Date;
  }>
> {
  return await args.db
    .select({
      id: caseOutputs.id,
      outputType: caseOutputs.outputType,
      outputVersion: caseOutputs.outputVersion,
      content: caseOutputs.content,
      metadata: caseOutputs.metadata,
      computerSessionId: caseOutputs.computerSessionId,
      costCents: caseOutputs.costCents,
      createdAt: caseOutputs.createdAt,
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
    .orderBy(sql`${caseOutputs.outputType}::text`);
}

/**
 * Full version history for one (case, type). Used by the version
 * selector in Stage 08's review UI.
 */
export async function getOutputVersionHistory(args: {
  db: Db;
  caseId: string;
  outputType: OutputType;
}): Promise<
  Array<{
    id: string;
    outputVersion: number;
    isCurrent: boolean;
    createdAt: Date;
    costCents: bigint | null;
  }>
> {
  return await args.db
    .select({
      id: caseOutputs.id,
      outputVersion: caseOutputs.outputVersion,
      isCurrent: caseOutputs.isCurrent,
      createdAt: caseOutputs.createdAt,
      costCents: caseOutputs.costCents,
    })
    .from(caseOutputs)
    .where(
      and(
        eq(caseOutputs.caseId, args.caseId),
        eq(caseOutputs.outputType, args.outputType),
        isNull(caseOutputs.deletedAt),
      ),
    )
    .orderBy(desc(caseOutputs.outputVersion));
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
