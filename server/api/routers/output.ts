import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { caseOutputs, outputTypeEnum } from "@/server/db/schema";
import type { OutputType } from "@/server/services/computer/types";
import { db as ownerDb, type Db } from "@/server/db/client";
import {
  attorneyProcedure,
  protectedProcedure,
  router,
} from "@/server/api/trpc";
import {
  getCurrentOutputsForList,
  getOutputVersionHistory,
  restoreOutputVersion,
  setOutputApproval,
  updateOutputContent,
} from "@/server/services/output";
import {
  compileFullPackagePdf,
  renderPerOutputPdf,
} from "@/server/services/pdf";
import { mdToSafeHtml } from "@/lib/markdown";
import { rateLimit } from "@/server/services/ratelimit";
import { inngest } from "@/server/jobs/client";
import { AppError, appErrorToTrpcCode } from "@/lib/errors";

/**
 * Stage 08 output review router. Every mutation goes through
 * `attorneyProcedure` (active-attorney profile required); every query
 * uses `protectedProcedure` so reads work even for an attorney whose
 * profile is suspended (read-only mode).
 *
 * RLS: queries run on `ctx.db` (user-scoped tx); writes that need to
 * touch `case_events` (via `transitionCase` indirectly) or auto-bypass
 * RLS use `ownerDb`.
 *
 * Mutation matrix:
 *   - update     → un-approve required (service throws CONFLICT)
 *   - regenerate → auto-unapprove THEN emit event (no race window)
 *   - approve / unapprove → flip in single tx
 *   - restoreVersion → copy prior content into a new is_current row
 *   - downloadPdf / downloadPackage → render fresh, return signed URL
 */

const ListInput = z.object({ caseId: z.uuid() });
const GetInput = z.object({ outputId: z.uuid() });
const ListVersionsInput = z.object({
  caseId: z.uuid(),
  outputType: z.enum(outputTypeEnum.enumValues),
  subgroupKey: z.string().min(1).max(200).optional(),
});

// Markdown content cap: 200_000 chars (~50 pages). Stage 07 prompt
// cap is ~12k chars; an attorney's edits adding context shouldn't
// exceed an order of magnitude beyond that.
const UpdateInput = z.object({
  outputId: z.uuid(),
  content: z.string().min(1).max(200_000),
});

const ApproveInput = z.object({
  outputId: z.uuid(),
  notes: z.string().max(2000).optional(),
});

const UnapproveInput = z.object({ outputId: z.uuid() });

const RegenerateInput = z.object({
  outputId: z.uuid(),
  guidance: z.string().min(1).max(5000).optional(),
});

const RestoreVersionInput = z.object({ fromVersionId: z.uuid() });

const DownloadPdfInput = z.object({ outputId: z.uuid() });
const DownloadPackageInput = z.object({ caseId: z.uuid() });

/** Helper: normalize errors to TRPC codes. Used at the boundary of
 *  every mutation to keep error handling consistent (and so tests can
 *  assert on the typed code field). */
function rethrowAsTrpc(err: unknown): never {
  if (err instanceof TRPCError) throw err;
  if (err instanceof AppError) {
    throw new TRPCError({
      code: appErrorToTrpcCode(err.code),
      message: err.message,
    });
  }
  throw err;
}

/** RLS gate: confirms the caller can see the output via ctx.db.
 *  Returns the caseId (needed by mutations that pivot to ownerDb).
 *  NOT_FOUND covers both "doesn't exist" and "not your case" so
 *  there's no existence oracle. */
async function gateOutputAccess(args: {
  ctxDb: Db;
  outputId: string;
}): Promise<{
  caseId: string;
  outputType: OutputType;
  subgroupKey: string | null;
}> {
  const [row] = await args.ctxDb
    .select({
      caseId: caseOutputs.caseId,
      outputType: caseOutputs.outputType,
      subgroupKey: caseOutputs.subgroupKey,
    })
    .from(caseOutputs)
    .where(
      and(eq(caseOutputs.id, args.outputId), isNull(caseOutputs.deletedAt)),
    )
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "output not found" });
  }
  return row;
}

export const outputRouter = router({
  list: protectedProcedure.input(ListInput).query(async ({ ctx, input }) => {
    // Slim projection — the grid card view doesn't need full prose.
    // RLS hides outputs the caller can't see; result is the slim
    // metadata set, alphabetically + subgroup-stable ordered.
    return await getCurrentOutputsForList({
      db: ctx.db,
      caseId: input.caseId,
    });
  }),

  get: protectedProcedure.input(GetInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(caseOutputs)
      .where(
        and(eq(caseOutputs.id, input.outputId), isNull(caseOutputs.deletedAt)),
      )
      .limit(1);
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "output not found" });
    }
    return row;
  }),

  listVersions: protectedProcedure
    .input(ListVersionsInput)
    .query(async ({ ctx, input }) => {
      // Confirm the case is visible (RLS gate). The history query
      // itself doesn't enforce RLS because `getOutputVersionHistory`
      // accepts any Db; use ctx.db here so the check + read share one
      // RLS-engaged session.
      return await getOutputVersionHistory({
        db: ctx.db,
        caseId: input.caseId,
        outputType: input.outputType,
        ...(input.subgroupKey !== undefined
          ? { subgroupKey: input.subgroupKey }
          : {}),
      });
    }),

  update: attorneyProcedure
    .input(UpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      // RLS check — the user-scoped read fails fast for cross-attorney access.
      await gateOutputAccess({ ctxDb: ctx.db, outputId: input.outputId });

      try {
        const result = await ownerDb.transaction(async (tx) =>
          updateOutputContent({
            tx: tx as unknown as Db,
            outputId: input.outputId,
            content: input.content,
            // Pre-render + sanitize so reads don't re-run marked.
            // Sanitization runs even though the content originates from
            // Tiptap (defense in depth — paste-from-Word can leak past
            // the editor's schema).
            contentHtml: mdToSafeHtml(input.content),
            attorneyId: userId,
          }),
        );
        return {
          ok: true as const,
          outputId: result.outputId,
          outputVersion: result.outputVersion,
        };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  approve: attorneyProcedure
    .input(ApproveInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      await gateOutputAccess({ ctxDb: ctx.db, outputId: input.outputId });

      try {
        await ownerDb.transaction(async (tx) =>
          setOutputApproval({
            tx: tx as unknown as Db,
            outputId: input.outputId,
            approved: true,
            attorneyId: userId,
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
          }),
        );
        return { ok: true as const };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  unapprove: attorneyProcedure
    .input(UnapproveInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      await gateOutputAccess({ ctxDb: ctx.db, outputId: input.outputId });

      try {
        await ownerDb.transaction(async (tx) =>
          setOutputApproval({
            tx: tx as unknown as Db,
            outputId: input.outputId,
            approved: false,
            attorneyId: userId,
          }),
        );
        return { ok: true as const };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  regenerate: attorneyProcedure
    .input(RegenerateInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;

      const rl = await rateLimit("output.regenerate", userId);
      if (!rl.success) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Regenerate rate limit reached (${rl.limit}/hour). Try again later.`,
        });
      }

      const access = await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.outputId,
      });

      // Auto-un-approve in the SAME tx as the event-emit-trigger so the
      // approval state can't go stale during the regen window. Idempotent
      // on already-unapproved rows (service returns `changed: false`).
      try {
        await ownerDb.transaction(async (tx) =>
          setOutputApproval({
            tx: tx as unknown as Db,
            outputId: input.outputId,
            approved: false,
            attorneyId: userId,
          }),
        );
      } catch (err) {
        rethrowAsTrpc(err);
      }

      // Emit AFTER the unapprove commits — order matters: if emit
      // failed before the unapprove, the case would have a stale-
      // approved current row while a regenerate ran. The reverse (emit
      // then unapprove fail) just means the regen runs but the row
      // stays approved; the regen-output handler will create a fresh
      // (unapproved) version anyway.
      const { ids } = await inngest.send({
        name: "case/output.regenerate.requested",
        data: {
          caseId: access.caseId,
          outputId: input.outputId,
          ...(input.guidance !== undefined ? { guidance: input.guidance } : {}),
        },
      });
      return { ok: true as const, eventId: ids[0] ?? null };
    }),

  restoreVersion: attorneyProcedure
    .input(RestoreVersionInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.fromVersionId,
      });

      try {
        const result = await ownerDb.transaction(async (tx) =>
          restoreOutputVersion({
            tx: tx as unknown as Db,
            fromVersionId: input.fromVersionId,
            attorneyId: userId,
          }),
        );
        return {
          ok: true as const,
          outputId: result.outputId,
          outputVersion: result.outputVersion,
        };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  downloadPdf: attorneyProcedure
    .input(DownloadPdfInput)
    .mutation(async ({ ctx, input }) => {
      const access = await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.outputId,
      });
      try {
        const result = await renderPerOutputPdf({
          db: ctx.db,
          caseId: access.caseId,
          outputId: input.outputId,
        });
        return { url: result.url, bytes: result.bytes };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  downloadPackage: attorneyProcedure
    .input(DownloadPackageInput)
    .mutation(async ({ ctx, input }) => {
      // RLS gate via a current-outputs read. If the caller can't see
      // the case, getCurrentOutputs returns an empty array — and
      // compile rejects with BAD_REQUEST. Defense in depth.
      try {
        const result = await compileFullPackagePdf({
          db: ctx.db,
          caseId: input.caseId,
        });
        return { url: result.url, bytes: result.bytes };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),
});
