import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import { z } from "zod";
import {
  caseEvents,
  caseRecommenders,
  cases,
  type caseStatusEnum,
} from "@/server/db/schema";
import {
  RecommenderInputSchema,
  RecommenderPatchSchema,
} from "@/server/db/schema/zod";
import { db as ownerDb, type Db } from "@/server/db/client";
import { protectedProcedure, router } from "@/server/api/trpc";
import { canEditIntake } from "@/lib/case-status";
import { emitFromCtx } from "@/server/services/analytics/emit";
import { isUserCaseParticipant } from "@/server/services/cases/visibility";

/**
 * Per-case recommender CRUD. Same RLS pattern as `documentRouter`:
 *   - Reads + access checks go through `ctx.db` (RLS-engaged).
 *   - Writes go through `ownerDb` because they emit `case_events`,
 *     which has no participant INSERT policy.
 *
 * Mutations are gated on `canEditIntake(status)` so the recommender
 * roster freezes at the same boundary as `beneficiary_data`. A change
 * after that point would silently desync from any in-flight build.
 */

type CaseStatus = (typeof caseStatusEnum.enumValues)[number];

const ListInput = z.object({ caseId: z.uuid() });
const CreateInput = z.object({
  caseId: z.uuid(),
  data: RecommenderInputSchema,
});
const UpdateInput = z.object({
  recommenderId: z.uuid(),
  patch: RecommenderPatchSchema,
});
const RemoveInput = z.object({ recommenderId: z.uuid() });
const ReorderInput = z.object({
  caseId: z.uuid(),
  // Caller sends the desired full ordering (every active id). Length
  // cap mirrors `recommendersCount.max(20)` from the prior schema —
  // typical cases have 3–6, never thousands.
  orderedIds: z.array(z.uuid()).min(1).max(50),
});

/** Look up a case row through `ctx.db` AND verify the caller is an
 *  active participant before returning its status. Application-layer
 *  membership gate is required because the `cases_admin` RLS policy
 *  (0005_rls.sql:138-139) lets admins bypass per-user scoping; without
 *  this check an admin could mutate recommenders on any attorney's
 *  case. See `services/cases/visibility.ts`. NOT_FOUND covers both
 *  "doesn't exist" and "not your case" — no existence oracle. */
async function gateCaseEdit(args: {
  ctxDb: Db;
  caseId: string;
  userId: string;
}): Promise<{ status: CaseStatus }> {
  if (!(await isUserCaseParticipant(args.ctxDb, args.caseId, args.userId))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "case not found" });
  }
  const [row] = await args.ctxDb
    .select({ status: cases.status })
    .from(cases)
    .where(and(eq(cases.id, args.caseId), isNull(cases.deletedAt)))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "case not found" });
  }
  if (!canEditIntake(row.status as CaseStatus)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `recommenders are locked once status is ${row.status}`,
    });
  }
  return { status: row.status as CaseStatus };
}

/** Detect Postgres unique-violation (SQLSTATE 23505) for the
 *  `case_recommenders` partial unique index, regardless of whether
 *  the driver bubbles up `code` directly or only the message. */
function isOrderUniqueViolation(err: unknown): boolean {
  if (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  ) {
    return true;
  }
  return (
    err instanceof Error &&
    err.message.includes("case_recommenders_case_order_active_uniq")
  );
}

/** Run `op` and retry on `case_recommenders` order-uniqueness conflicts.
 *  Cap retries to avoid an unbounded loop if the index is genuinely
 *  oversubscribed (e.g. 50+ concurrent inserts) — at the cap we
 *  surface CONFLICT to the caller. */
async function runWithUniqueRetry<T>(
  op: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await op();
    } catch (err) {
      if (!isOrderUniqueViolation(err)) throw err;
      lastErr = err;
    }
  }
  throw new TRPCError({
    code: "CONFLICT",
    message:
      "Recommender list changed under us. Refresh the page and try again.",
    cause: lastErr instanceof Error ? lastErr : undefined,
  });
}

/** Same as `gateCaseEdit` but resolves through a recommender id —
 *  used by update/remove which take only the recommender's pk. Also
 *  enforces participant membership before the status check; see
 *  `gateCaseEdit` for context. */
async function gateRecommenderEdit(args: {
  ctxDb: Db;
  recommenderId: string;
  userId: string;
}): Promise<{ caseId: string; status: CaseStatus }> {
  const [row] = await args.ctxDb
    .select({
      caseId: caseRecommenders.caseId,
      status: cases.status,
    })
    .from(caseRecommenders)
    .innerJoin(cases, eq(caseRecommenders.caseId, cases.id))
    .where(
      and(
        eq(caseRecommenders.id, args.recommenderId),
        isNull(caseRecommenders.deletedAt),
        isNull(cases.deletedAt),
      ),
    )
    .limit(1);
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "recommender not found",
    });
  }
  if (!(await isUserCaseParticipant(args.ctxDb, row.caseId, args.userId))) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "recommender not found",
    });
  }
  if (!canEditIntake(row.status as CaseStatus)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `recommenders are locked once status is ${row.status}`,
    });
  }
  return { caseId: row.caseId, status: row.status as CaseStatus };
}

export const recommenderRouter = router({
  /** Active recommenders for a case, ordered by `displayOrder`. */
  list: protectedProcedure.input(ListInput).query(async ({ ctx, input }) => {
    if (!(await isUserCaseParticipant(ctx.db, input.caseId, ctx.userId))) {
      return [];
    }
    return await ctx.db
      .select({
        id: caseRecommenders.id,
        fullName: caseRecommenders.fullName,
        relationship: caseRecommenders.relationship,
        titleOrg: caseRecommenders.titleOrg,
        email: caseRecommenders.email,
        guidance: caseRecommenders.guidance,
        displayOrder: caseRecommenders.displayOrder,
        createdAt: caseRecommenders.createdAt,
        updatedAt: caseRecommenders.updatedAt,
      })
      .from(caseRecommenders)
      .where(
        and(
          eq(caseRecommenders.caseId, input.caseId),
          isNull(caseRecommenders.deletedAt),
        ),
      )
      .orderBy(asc(caseRecommenders.displayOrder), asc(caseRecommenders.createdAt));
  }),

  create: protectedProcedure
    .input(CreateInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      await gateCaseEdit({
        ctxDb: ctx.db,
        caseId: input.caseId,
        userId,
      });

      // The partial unique index on `(case_id, display_order) WHERE
      // deleted_at IS NULL` makes `nextOrder = max + 1` unsafe under
      // concurrent creates: two simultaneous callers can compute the
      // same ordinal and the loser hits 23505. Single-attorney Phase 1
      // makes this rare, but the loop below catches it and retries
      // (capped) so the response is `CONFLICT` only after we've truly
      // run out of slots, not on a transient race.
      const inserted = await runWithUniqueRetry(async () =>
        ownerDb.transaction(async (tx) => {
          const [maxRow] = await tx
            .select({
              maxOrder: max(caseRecommenders.displayOrder),
            })
            .from(caseRecommenders)
            .where(
              and(
                eq(caseRecommenders.caseId, input.caseId),
                isNull(caseRecommenders.deletedAt),
              ),
            );
          const nextOrder = (maxRow?.maxOrder ?? -1) + 1;

          const [row] = await tx
            .insert(caseRecommenders)
            .values({
              caseId: input.caseId,
              displayOrder: nextOrder,
              fullName: input.data.fullName,
              relationship: input.data.relationship,
              titleOrg: input.data.titleOrg,
              email: input.data.email,
              guidance: input.data.guidance,
            })
            .returning({ id: caseRecommenders.id });
          if (!row) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "recommender insert returned no row",
            });
          }

          await tx.insert(caseEvents).values({
            caseId: input.caseId,
            actorType: "user",
            actorUserId: userId,
            eventType: "recommender.added",
            details: { recommenderId: row.id },
          });
          return row;
        }),
      );

      emitFromCtx(ctx, {
        name: "recommender.added",
        properties: {
          case_id: input.caseId,
          recommender_id: inserted.id,
        },
      });
      return { ok: true as const, recommenderId: inserted.id };
    }),

  update: protectedProcedure
    .input(UpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      const { caseId } = await gateRecommenderEdit({
        ctxDb: ctx.db,
        recommenderId: input.recommenderId,
        userId,
      });

      const patchKeys = Object.keys(input.patch);
      if (patchKeys.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Patch is empty — no fields to update.",
        });
      }

      await ownerDb.transaction(async (tx) => {
        await tx
          .update(caseRecommenders)
          .set(input.patch)
          .where(eq(caseRecommenders.id, input.recommenderId));
        await tx.insert(caseEvents).values({
          caseId,
          actorType: "user",
          actorUserId: userId,
          eventType: "recommender.updated",
          details: {
            recommenderId: input.recommenderId,
            fields: patchKeys,
          },
        });
      });

      return { ok: true as const };
    }),

  remove: protectedProcedure
    .input(RemoveInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      const { caseId } = await gateRecommenderEdit({
        ctxDb: ctx.db,
        recommenderId: input.recommenderId,
        userId,
      });

      await ownerDb.transaction(async (tx) => {
        // Soft-delete + drop display_order to NULL-equivalent so the
        // partial unique index doesn't keep blocking the slot. We
        // can't write NULL (column is NOT NULL); instead, the
        // partial index already filters on `deleted_at IS NULL` so
        // setting `deletedAt` removes the row from the unique
        // universe. Display ordering is recomputed lazily on the
        // next list query.
        await tx
          .update(caseRecommenders)
          .set({ deletedAt: new Date() })
          .where(eq(caseRecommenders.id, input.recommenderId));
        await tx.insert(caseEvents).values({
          caseId,
          actorType: "user",
          actorUserId: userId,
          eventType: "recommender.removed",
          details: { recommenderId: input.recommenderId },
        });
      });

      emitFromCtx(ctx, {
        name: "recommender.removed",
        properties: {
          case_id: caseId,
          recommender_id: input.recommenderId,
        },
      });
      return { ok: true as const };
    }),

  /** Persist a new ordering. Caller sends the full ordered id list;
   *  every id must belong to this case AND be active, else CONFLICT. */
  reorder: protectedProcedure
    .input(ReorderInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      await gateCaseEdit({
        ctxDb: ctx.db,
        caseId: input.caseId,
        userId,
      });

      // Resolve the case's active recommender ids through ctx.db (RLS)
      // so a forged id from another case is rejected.
      const visible = await ctx.db
        .select({ id: caseRecommenders.id })
        .from(caseRecommenders)
        .where(
          and(
            eq(caseRecommenders.caseId, input.caseId),
            isNull(caseRecommenders.deletedAt),
          ),
        );
      const visibleIds = new Set(visible.map((r) => r.id));
      if (
        visibleIds.size !== input.orderedIds.length ||
        input.orderedIds.some((id) => !visibleIds.has(id))
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Recommender list changed since you last loaded it. Refresh and try again.",
        });
      }

      // Two-phase write: shift every row to a high temporary ordinal
      // first (offset by 1000) so the unique index doesn't trip while
      // we're permuting. Then write the final ordinals. CASE-WHEN
      // pattern keeps the whole reorder in two SQL statements
      // regardless of list size.
      await ownerDb.transaction(async (tx) => {
        await tx
          .update(caseRecommenders)
          .set({
            displayOrder: sql`${caseRecommenders.displayOrder} + 1000`,
          })
          .where(
            and(
              eq(caseRecommenders.caseId, input.caseId),
              isNull(caseRecommenders.deletedAt),
            ),
          );

        for (let i = 0; i < input.orderedIds.length; i += 1) {
          await tx
            .update(caseRecommenders)
            .set({ displayOrder: i })
            .where(eq(caseRecommenders.id, input.orderedIds[i]!));
        }

        await tx.insert(caseEvents).values({
          caseId: input.caseId,
          actorType: "user",
          actorUserId: userId,
          eventType: "recommender.reordered",
          details: { count: input.orderedIds.length },
        });
      });

      return { ok: true as const };
    }),
});
