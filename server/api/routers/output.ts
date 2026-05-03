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
  approveOutput,
  clearOutputDraft,
  getCurrentOutputsForList,
  getOutputVersionHistory,
  restoreOutputVersion,
  saveOutputDraft,
  setOutputApproval,
  summarizeOutputApprovals,
  updateOutputContent,
} from "@/server/services/output";
import {
  compileFullPackagePdf,
  renderPerOutputPdf,
} from "@/server/services/pdf";
import { mdToSafeHtml } from "@/lib/markdown";
import { rateLimit } from "@/server/services/ratelimit";
import { inngest } from "@/server/jobs/client";
import {
  outputApprovedNotificationEvent,
  packageReadyNotificationEvent,
} from "@/server/services/email/notifications";
import { AppError, appErrorToTrpcCode } from "@/lib/errors";
import { emitFromCtx } from "@/server/services/analytics/emit";

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

// Per-case approval tally for the dashboard's case list. Cap at 200 ids
// so a malicious caller can't hit the DB with a huge IN-list.
const SummarizeInput = z.object({
  caseIds: z.array(z.uuid()).max(200),
});
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

// Drafts allow `""` (the user cleared the editor in mid-edit) — see
// `saveOutputDraft` JSDoc. Same length cap as commits.
const SaveDraftInput = z.object({
  outputId: z.uuid(),
  content: z.string().max(200_000),
});

const ClearDraftInput = z.object({ outputId: z.uuid() });

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
  /**
   * Per-case approval tally for the dashboard. RLS on `case_outputs`
   * filters out cases the caller can't see, so unauthorized ids
   * silently return an empty entry (no existence oracle).
   *
   * Returns a plain object map so superjson serializes cleanly across
   * the wire — `Map` values are serializable but the Record shape is
   * easier to consume in client components.
   */
  summarize: protectedProcedure
    .input(SummarizeInput)
    .query(async ({ ctx, input }) => {
      const tally = await summarizeOutputApprovals({
        db: ctx.db,
        caseIds: input.caseIds,
      });
      const out: Record<string, { approved: number; total: number }> = {};
      for (const [caseId, counts] of tally) out[caseId] = counts;
      return out;
    }),

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

  /**
   * Stage 11 W3 — save the editor's pending draft IN PLACE on the
   * current row, no new version, no `attorney_approved` change. The
   * editor's 3s debounce calls this; "Save version" goes through
   * `update` instead.
   *
   * Rate-limited at 120/min/user (see `ratelimit.ts` for rationale).
   * The service layer's idempotency check still drops no-op writes
   * even when the limiter is bypassed.
   */
  saveDraft: attorneyProcedure
    .input(SaveDraftInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;

      const rl = await rateLimit("output.saveDraft", userId);
      if (!rl.success) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Auto-save rate limit reached (${rl.limit}/min). Pause editing for a moment.`,
        });
      }

      const access = await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.outputId,
      });
      try {
        const r = await ownerDb.transaction(async (tx) =>
          saveOutputDraft({
            tx: tx as unknown as Db,
            outputId: input.outputId,
            content: input.content,
          }),
        );
        // Emit only when the service actually wrote — `saved=false`
        // means the draft was identical to the prior write (idempotent
        // no-op), so emitting it would inflate the autosave count.
        if (r.saved) {
          emitFromCtx(ctx, {
            name: "output.draft_saved",
            properties: {
              case_id: access.caseId,
              output_id: input.outputId,
              content_length: input.content.length,
            },
          });
        }
        return { ok: true as const, saved: r.saved };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  /**
   * Stage 11 W3 — discard the pending draft. Used by the editor's
   * Cancel button. Idempotent: clearing an empty draft is a no-op.
   */
  clearDraft: attorneyProcedure
    .input(ClearDraftInput)
    .mutation(async ({ ctx, input }) => {
      await gateOutputAccess({ ctxDb: ctx.db, outputId: input.outputId });
      try {
        const r = await ownerDb.transaction(async (tx) =>
          clearOutputDraft({
            tx: tx as unknown as Db,
            outputId: input.outputId,
          }),
        );
        return { ok: true as const, cleared: r.cleared };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  update: attorneyProcedure
    .input(UpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      // RLS check — the user-scoped read fails fast for cross-attorney access.
      const access = await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.outputId,
      });

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
        emitFromCtx(ctx, {
          name: "output.version_saved",
          properties: {
            case_id: access.caseId,
            output_id: result.outputId,
            version: result.outputVersion,
          },
        });
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
      const access = await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.outputId,
      });

      try {
        // `approveOutput` flushes any pending draft into a new version
        // BEFORE setting `attorney_approved=true`, so the approval
        // always lands on what the user sees on screen — not on a
        // stale baseline that the autosave hadn't yet committed
        // (W3 + W4.3 contract).
        const result = await ownerDb.transaction(async (tx) =>
          approveOutput({
            tx: tx as unknown as Db,
            outputId: input.outputId,
            attorneyId: userId,
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
          }),
        );
        emitFromCtx(ctx, {
          name: "output.approved",
          properties: {
            case_id: access.caseId,
            // Use the post-flush id — when a draft was flushed this is
            // the FRESH row that got the approval stamp, not the old one.
            output_id: result.approvedOutputId,
            draft_flushed: result.draftFlushed,
          },
        });

        // Notification fan-out. Two events may fire:
        //   1. `output.approved` — always, one per approve click.
        //   2. `package.ready` — only when this approval flips the case
        //      to "every current output approved". Re-firing on a
        //      subsequent unapprove → re-approve is acceptable: each
        //      event represents a fresh "package is whole again" state
        //      and the email points at the live download URL.
        const approvals = await summarizeOutputApprovals({
          db: ctx.db,
          caseIds: [access.caseId],
        });
        const tally = approvals.get(access.caseId);
        const allApproved =
          tally !== undefined && tally.total > 0 && tally.approved === tally.total;
        const events: Parameters<typeof inngest.send>[0] = [
          {
            name: outputApprovedNotificationEvent.name,
            data: { caseId: access.caseId, outputId: result.approvedOutputId },
          },
        ];
        if (allApproved) {
          events.push({
            name: packageReadyNotificationEvent.name,
            data: { caseId: access.caseId },
          });
        }
        try {
          await inngest.send(events);
        } catch (err) {
          console.error("[notification.output.approved] emit failed", {
            caseId: access.caseId,
            err,
          });
        }

        return {
          ok: true as const,
          // When draft was flushed, `approvedOutputId` is the NEW
          // version's id — client navigates to it so the URL keeps
          // pointing at the current row.
          approvedOutputId: result.approvedOutputId,
          draftFlushed: result.draftFlushed,
        };
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
        emitFromCtx(ctx, {
          name: "package.exported",
          properties: {
            case_id: input.caseId,
            // The package PDF has no separate DB row — its identity IS
            // the storage key (`cases/<id>/pdf/package-<ts>.pdf`),
            // which is stable per-export and useful for de-dup analytics.
            package_id: result.key,
            size_bytes: result.bytes,
          },
        });
        return { url: result.url, bytes: result.bytes };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),
});
