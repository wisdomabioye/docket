import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "@/server/api/trpc";
import { rateLimit } from "@/server/services/ratelimit";

/**
 * Stage 11 W5 — global search backing the topbar's `Cmd+K` bar.
 *
 * Queries are gated by application-layer participant membership: both
 * the cases query and the documents query filter on a subquery against
 * `case_participants` keyed by the session user. RLS stays as a safety
 * net but is NOT the gate — the `cases_admin` / `case_documents_admin`
 * policies bypass RLS for admin sessions, so a topbar search by an
 * admin who isn't on the case would otherwise return every attorney's
 * data. Closes the search surface of open_issues #59. Admin-side
 * search lives behind `/admin/*` procedures (intentionally unscoped).
 *
 * Indexes (see migration `0019_search_trigram_indexes.sql`):
 *   - cases (lower(beneficiary_data->>'fullName'))
 *   - case_documents (lower(original_filename))
 *   - case_documents (lower(left(extracted_text, 4000)))
 *
 * All three are GIN trigram + partial-on-deleted-at-null, so the
 * query plan picks an Index Scan even for short queries (≥3 chars =
 * one trigram). Sub-3-char queries still run; the index falls back to
 * a Recheck step but the table is small in Phase 1.
 *
 * Soft-delete: every WHERE includes `deleted_at IS NULL` so archived
 * cases / removed documents never leak in. Cross-cutting #178.
 */

const QInput = z.object({
  q: z.string().min(1).max(120),
  // Per-category cap. Default 8 keeps the dropdown skimmable; max 20
  // is the UI's hard ceiling — beyond that the user should narrow the
  // query rather than scroll a 50-row dropdown.
  limit: z.number().int().min(1).max(20).default(8),
});

/* Short-string matches (beneficiary names, filenames) use the
 * trigram `%` operator; threshold comes from Postgres' default 0.3
 * (`pg_trgm.similarity_threshold`). Long-string matches (document
 * extracted text) use `LIKE` substring containment — the trigram GIN
 * index supports that natively, and substring containment is the
 * natural semantic for "find this word inside this doc". */

export type SearchCaseHit = {
  id: string;
  beneficiaryName: string;
  visaType: string;
  status: string;
  similarity: number;
};

export type SearchDocumentHit = {
  id: string;
  caseId: string;
  filename: string;
  /** Up to ~160-char excerpt around the first match (or document
   *  start if the match is in the filename only). Already trimmed
   *  for whitespace; suitable for direct display in the dropdown. */
  snippet: string;
  similarity: number;
};

export type SearchGlobalResult = {
  cases: SearchCaseHit[];
  documents: SearchDocumentHit[];
};

export const searchRouter = router({
  /**
   * Combined cases + documents lookup. Empty/blank query returns
   * empty arrays without firing any SQL — the client's `enabled` gate
   * normally prevents this, but the server short-circuits as defense
   * in depth.
   */
  global: protectedProcedure
    .input(QInput)
    .query(async ({ ctx, input }): Promise<SearchGlobalResult> => {
      const { userId } = ctx;
      const trimmed = input.q.trim();
      if (trimmed.length === 0) {
        return { cases: [], documents: [] };
      }

      const rl = await rateLimit("search.global", userId);
      if (!rl.success) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Search rate limit reached (${rl.limit}/min). Pause briefly.`,
        });
      }

      const needle = trimmed.toLowerCase();
      // ILIKE pattern for substring containment in long text. Escape
      // `%` and `_` so a query like "50%_off" doesn't behave as a
      // wildcard. Trigram GIN supports the `LIKE`/`ILIKE` operators
      // when the pattern has at least 3 consecutive non-wildcard
      // characters — our minimum query length on the client is 2, so
      // for a 1- or 2-char query the planner falls back to a seq scan
      // (acceptable: corpus is small, and the client's
      // `enabled: q.length >= 2` rate-limits noise anyway).
      const ilikePattern = `%${escapeLike(needle)}%`;
      // Substring offset on the snippet: the trigram index uses
      // `left(extracted_text, 4000)` so we mirror that same prefix
      // when computing the snippet — anything past 4000 chars wasn't
      // indexed and doesn't deserve to surface in results.
      const SNIPPET_RADIUS = 60;
      const SNIPPET_MAX = 160;

      // Two parallel queries via the same RLS-engaged session.
      // `Promise.all` gives us a single round-trip latency budget for
      // the topbar autocomplete (target: <50ms p95).
      const [caseRows, documentRows] = await Promise.all([
        ctx.db.execute(sql`
          select
            id,
            (beneficiary_data ->> 'fullName') as beneficiary_name,
            visa_type::text as visa_type,
            status::text as status,
            similarity(lower(beneficiary_data ->> 'fullName'), ${needle}) as sim
          from cases
          where deleted_at is null
            and beneficiary_data ->> 'fullName' is not null
            and lower(beneficiary_data ->> 'fullName') % ${needle}
            and id in (
              select case_id from case_participants
              where user_id = ${userId} and removed_at is null
            )
          order by sim desc, beneficiary_data ->> 'fullName' asc
          limit ${input.limit}
        `),
        // Filename uses trigram similarity (fuzzy short-string).
        // Extracted text uses substring containment via the trigram-
        // backed `LIKE` — catches a query like "extraordinary" inside
        // a 200-char paragraph, which `%` similarity would drown out
        // as noise. Score: similarity(filename) for filename hits,
        // 1.0 for body hits (binary "found"); ties break by filename.
        // Comments live OUTSIDE the SQL template — Drizzle's sql tag
        // tokenizes `--` lines and binds parameters strangely when
        // mixed with comments.
        ctx.db.execute(sql`
          select
            id,
            case_id,
            original_filename,
            extracted_text,
            greatest(
              similarity(lower(original_filename), ${needle}),
              case
                when extracted_text is not null
                 and lower(left(extracted_text, 4000)) like ${ilikePattern}
                then 1.0
                else 0
              end
            ) as sim
          from case_documents
          where deleted_at is null
            and (
              lower(original_filename) % ${needle}
              or (
                extracted_text is not null
                and lower(left(extracted_text, 4000)) like ${ilikePattern}
              )
            )
            and case_id in (
              select case_id from case_participants
              where user_id = ${userId} and removed_at is null
            )
          order by sim desc, original_filename asc
          limit ${input.limit}
        `),
      ]);

      const cases: SearchCaseHit[] = [];
      for (const row of caseRows as ReadonlyArray<Record<string, unknown>>) {
        const id = row.id;
        const name = row.beneficiary_name;
        const visa = row.visa_type;
        const status = row.status;
        const sim = row.sim;
        if (
          typeof id === "string" &&
          typeof name === "string" &&
          typeof visa === "string" &&
          typeof status === "string" &&
          typeof sim === "number"
        ) {
          cases.push({
            id,
            beneficiaryName: name,
            visaType: visa,
            status,
            similarity: sim,
          });
        }
      }

      const documents: SearchDocumentHit[] = [];
      for (const row of documentRows as ReadonlyArray<Record<string, unknown>>) {
        const id = row.id;
        const caseId = row.case_id;
        const filename = row.original_filename;
        const extracted = row.extracted_text;
        const sim = row.sim;
        if (
          typeof id === "string" &&
          typeof caseId === "string" &&
          typeof filename === "string" &&
          typeof sim === "number"
        ) {
          documents.push({
            id,
            caseId,
            filename,
            snippet: buildSnippet({
              extracted: typeof extracted === "string" ? extracted : null,
              filename,
              needle,
              radius: SNIPPET_RADIUS,
              maxLength: SNIPPET_MAX,
            }),
            similarity: sim,
          });
        }
      }

      return { cases, documents };
    }),
});

/** Escape Postgres LIKE wildcards so user-typed `%` and `_` behave
 *  as literals. The ESCAPE clause defaults to backslash; we don't
 *  override it. Without escaping, a query of `50%` would match every
 *  document containing "50" plus arbitrary suffix. */
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Build a display-ready snippet for a document hit.
 *
 *   - If the match is in the extracted-text prefix: ±radius chars
 *     around the first occurrence, collapsed whitespace, leading/
 *     trailing ellipsis if we trimmed.
 *   - If the match is in the filename only (no extracted text or no
 *     hit in it): use the filename itself as the snippet so the
 *     dropdown still has a non-empty secondary line.
 */
function buildSnippet(args: {
  extracted: string | null;
  filename: string;
  needle: string;
  radius: number;
  maxLength: number;
}): string {
  const { extracted, filename, needle, radius, maxLength } = args;
  if (!extracted) return filename;
  // Match the same 4000-char window the trigram index covers — anything
  // beyond it wasn't searched, so a "match" out there would be a lie.
  // (Local name `prefix` rather than `window` to avoid shadowing the
  // global `window` identifier.)
  const prefix = extracted.slice(0, 4000).toLowerCase();
  const idx = prefix.indexOf(needle);
  if (idx < 0) return filename;

  const start = Math.max(0, idx - radius);
  const end = Math.min(extracted.length, idx + needle.length + radius);
  const slice = extracted.slice(start, end).replace(/\s+/g, " ").trim();
  // Cap defensively — `radius` is small enough that this rarely
  // triggers, but a needle with adjacent multi-byte runs could expand.
  const capped =
    slice.length > maxLength ? slice.slice(0, maxLength - 1) + "…" : slice;
  return (start > 0 ? "…" : "") + capped + (end < extracted.length ? "…" : "");
}
