# Open issues

Tracker for design questions and known gaps. Three sections:

- **Active** — needs decision or action soon (blocks current/next stage)
- **Phase-2 backlog** — known limitations to revisit when scale demands them
- **Resolved** — decisions captured for posterity

When a gap is identified but not fixed in the same response, it goes here.
"Concerns mentioned in chat" are not enough — add an entry.

---

## Active

### #4 — RLS test coverage is canary-only on writes

Status: Tracked.
Surfaced: 2026-04-27

`tests/integration/rls.test.ts` (29 tests) covers SELECT visibility for
every RLS-protected table. **Zero tests prove `WITH CHECK` clauses
actually block UPDATEs that try to move a row out of visibility.** Add
~10 mutation tests when Stage 05 begins exercising real writes.

---

### #7 — `case_participants.role` consistency with global `user_roles`

Status: Service-layer enforcement; not constrained at DB.
Surfaced: 2026-04-27

A user without the global `attorney` role in `user_roles` can be inserted
into `case_participants` with `role = 'attorney'`. Postgres has no way
to express "the user must hold this global role" without a check function.

**How to apply:** Stage 05's `case.addParticipant` service procedure must
verify `user_roles` membership before insert. If we ever add a
participant role beyond global roles (e.g., `observer` doesn't need a
global role), document the exception.

---

### #8 — Stage 03 UX gaps deferred to Stage 09 admin polish

Status: Documented; functional but not polished.
Surfaced: 2026-04-30 (Stage 03 review)

1. **`OnboardingForm` silent no-op on missing fields** —
   `app/(app)/onboarding/OnboardingForm.tsx` returns early without showing
   an error when `barNumber`, `agreementFilename`, or terms checkbox is
   empty. Browser `required` attribute catches most cases, but the form
   should surface its own errors. Trivial fix; deferred for now.

2. **`ActivateButton` has no confirm dialog + no reason input** —
   `app/(admin)/admin/attorneys/ActivateButton.tsx` is one-click. CLAUDE.md
   §5 (admin section) mandates "Activate / Suspend actions show confirm
   modal with reason field, stored in `audit_log.details`." The procedure
   accepts a `reason` arg; the UI doesn't pass it. Stage 09 ships the
   polished modal.

3. **`/onboarding` and `/admin/attorneys` pages have no rendering tests** —
   their underlying tRPC procedures are well-covered (14 tests in
   `attorney-onboarding.test.ts`), but the page components themselves
   aren't exercised. Manual smoke after sign-in.

---

### #9 — Lint rule for `accounts` import outside `server/auth/`

Status: Documented but never written.
Surfaced: 2026-04-29 (Stage 02 review)

The `accounts` table holds OAuth refresh/access/id tokens (tagged
`SECRET:high`). Stage 02 review noted we should add an ESLint
`no-restricted-imports` rule blocking imports of `accounts` from
anywhere outside `server/auth/`. Never implemented. ~5-line eslint
config addition.

---

### #14 — Stage 05 review backlog

Status: Documented; everything else from the careful review pass on Stage 05.
Surfaced: 2026-04-27 (Stage 05 review)

1. **`appErrorCode` helper duplicated** — `server/api/trpc.ts` (full
   mapping) + `server/api/routers/case.ts` (subset). Move to
   `lib/errors.ts` once a third caller appears.
2. **"Authz via ctx.db, then write via ownerDb" pattern repeated** in
   4 case procedures (create / archive / updateBeneficiary /
   completeIntake). Extract `withCaseAuthz(caseId, fn)` helper if a
   fifth procedure adopts it.
3. **Status string formatter** — `s.replace(/_/g, " ")` written
   inline in dashboard + case detail. Move to a `formatStatus()`
   helper in `lib/case-status.ts` when a third caller appears.
4. **Beneficiary jsonb casts in pages are redundant** —
   `(data.beneficiaryData as { fullName?: string } | null) ?? {}` in
   case detail / intake / dashboard. Drizzle's `.$type<>()` already
   infers `BeneficiaryData | null`. Direct field access with optional
   chain works without the cast. Cosmetic.
5. **No test for `case.create` PRECONDITION_FAILED** path (user with
   no organization). Hard to construct in current seed; add when seed
   has a user-without-org fixture.
6. **No test for `case.archive` from a non-participant** — RLS would
   deny via the authzCheck read, returning NOT_FOUND. Worth a test.
7. **`reviewSlaHours` is stored but unenforced** — no reminder email,
   no overdue UI. Phase 1 acceptable; Stage 11 (notifications) wires
   it.
8. **`case.list` returns full beneficiaryData jsonb in every row** —
   for a 25-item page that's potentially 25 KB. Could project just
   the fullName on the list endpoint and require `case.get` for full
   data. Pre-optimization; phase 2 if measured.

---

### #13 — Stage 05 RLS bypass pattern + deferred items

Status: Documented; functional but expanding the RLS bypass pattern.
Surfaced: 2026-04-27 (Stage 05 implementation)

1. **Several `case` procedures use the owner connection (RLS bypass) for
   writes** because the policies block the operation. Specifically:
   - `case.create` — bootstrap problem: `cases.WITH CHECK` requires
     `user_in_case(id)` but no participant exists yet on a fresh case.
   - `case.archive` — sets `deleted_at`, which flips the policy's
     `deleted_at is null` predicate to false → UPDATE rejected.
   - `case.updateBeneficiary` — writes to `case_events`, which has no
     participant INSERT policy.
   - `case.completeIntake` — same (writes case_events via transitionCase).

   In all four, **app-layer auth runs first** via the RLS-engaged
   `ctx.db` (membership check or case visibility read), and only then
   does the actual mutation run on `ownerDb.transaction()`. Documented
   in each procedure. Pattern is correct but more bypasses than I'd like.

   **Phase-2 fix:** add proper INSERT policies so participants can write
   case_events / cases via their own role:
   - `case_events_participant_insert`: allow when `user_in_case(case_id)`
   - `cases_member_insert`: allow on insert when `user_in_org(organization_id)`
   - Don't gate `cases` UPDATE on `deleted_at is null` in WITH CHECK
     (only USING) so soft-delete works.
   Then drop the owner-bypass paths in the case router.

2. **No tests for the case detail / intake / dashboard pages** — only
   the procedures underneath. Manual smoke after sign-in.

3. **`case.list` cursor pagination uses `createdAt < cursor.createdAt`
   only** — the `id` tiebreaker in the cursor object is captured but
   not used in the WHERE. Two cases with identical timestamps could
   both fall on the page boundary. Vanishingly rare; document.

4. **Beneficiary jsonb merge is shallow** — `{ ...existing, ...patch }`.
   Nested objects in patch overwrite nested objects in existing entirely.
   Phase 1 BeneficiaryDataSchema is flat; harmless. Stage 06+ may add
   nested fields where this matters.

5. **`appErrorCode` helper duplicated** between trpc.ts (full) and
   case.ts (subset). Could DRY when more routers throw AppError.

6. **No participants-management procedures yet** — adding/removing
   paralegals from a case (case_participants_primary_insert RLS policy
   exists but no tRPC procedure exposes it). Stage 09 admin work.

---

### #12 — Stage 04 deferred (waitlist + marketing)

Status: Documented; functional but not polished.
Surfaced: 2026-04-27 (Stage 04 review)

1. **No rate limiting on `marketing.joinWaitlist`** — Upstash Redis is in
   the env schema but not wired. A bot (or a typing visitor) could spam
   the endpoint. Honeypot defeats simple bots; still want per-IP cap
   (e.g. 5/min) once Upstash is live.
2. **No CAPTCHA / Turnstile** — honeypot only. Phase 2 if abuse appears.
3. **No PostHog `waitlist_signup` event** — env keys not configured;
   `lib/posthog.ts` stubs no-op when missing. Wire in Stage 11
   (notifications/polish) after PostHog account exists.
4. **`/terms` and `/privacy` are Phase-1 placeholders** — founder must
   replace with legal-reviewed copy before launch. Bumping
   `TERMS_VERSION` (in `server/auth/terms.ts`) re-prompts every attorney
   to re-accept.
5. **Robots.txt uses `NODE_ENV === 'production'`** — but Vercel preview
   deploys also set `NODE_ENV=production` and would `allow:"/"`. Should
   gate on `VERCEL_ENV === 'production'` once the env var is added.
   Until fixed, preview deploys risk SEO indexing.
6. **No tests for landing page rendering** — `app/page.tsx` and
   `WaitlistForm` are exercised manually only. The procedure underneath
   is well-covered.

---

### #10 — Performance optimizations (measured pre-empt)

Status: All deferred until measured. Listed so we don't lose them.
Surfaced: across Stages 02–03 reviews

1. **`proxy.ts` calls `auth()` on every request** — DB query per page
   render. Could short-circuit on cookie absence. Pre-optimization.
2. **tRPC `createTRPCContext` calls `auth()` per request** — same path
   as proxy. Together: 2 session queries per page that uses tRPC.
3. **`<TRPCReactProvider>` wraps marketing + login pages** that don't
   use tRPC. Could lift into the `(app)` route group only.
4. **`adminProcedure` middleware does `is_admin()` SQL per call** —
   could cache per-request once we have a request-context cache.
5. **`onboarding/page.tsx` runs `me.current()` then redirects** when
   user is active — wasted query on every dashboard-bound user. Could
   check `me.attorneyProfile` lazily.
6. **`admin.listPendingAttorneys` doesn't paginate** — fine at < 50 rows,
   real concern past 1k.

---

## Phase-2 backlog

### #3 — Phase-2 follow-ups recorded during Stage 01

Items intentionally deferred:

1. **`case_events` partitioning by month** — declarative partitioning
   becomes mechanical once row counts hit ~10M.
2. **`audit_log` partitioning** — same.
3. **`case_outputs.content` to object storage** at >1MB per row.
4. **Output pruning job** — drop unpinned, non-current versions older
   than N days. Stage 11.
5. **Read replicas** for eligibility-engine reads.
6. **GIN index on `attorney_profiles.bar_states`** when state-search
   becomes a feature.
7. **PII inventory CSV script** — emits a CSV of tagged columns.
8. **Slug reserved-word blocklist** for `organizations.slug`.
9. **Column-level encryption** for `accounts.refresh_token`/`access_token`/
   `id_token` and `sessions.session_token`. Currently rely on Postgres
   at-rest encryption (provider-managed). At consumer scale + SOC 2 prep,
   move to `pgcrypto` symmetric encryption with a per-deployment key in
   KMS / a vault.
10. **Hard-delete pathway** for GDPR right-to-erasure — separate from
    soft-delete. `eraseUser()` function nulls PII columns and writes an
    `audit_log` entry. Stage 09 stub.
11. **Multi-attorney firms** — `organization_members` already supports it;
    UI for invites/seats is Phase 2.
12. **Session-pruning cron** — Auth.js doesn't auto-delete expired
    `sessions` rows; needs an Inngest daily job. (Was #6 in active —
    promoted to Phase-2 backlog because it's not blocking now.)

---

### #11 — Auth & infra gaps deferred to later stages

Status: Tracked.

1. **Apple SSO** — provider commented out in `server/auth/config.ts`.
   Needs Apple Developer account + Services ID. Ship in Stage 11
   (notifications/polish) or sooner if user has account.
2. **`trustHost: true` is unconditional** in `server/auth/config.ts`.
   Needed for Vercel + dev. If we ever self-host on a non-trusted
   reverse proxy, scope it to dev + known prod hosts.
3. **No notification email on attorney activation** — admin clicks
   activate, attorney gets nothing until they next sign in. Fix:
   integrate Postmark in Stage 11.
4. **`signOut` server action has no test** — thin wrapper around
   Auth.js. Smoke-tested manually only.
5. **`<TRPCReactProvider>` wraps marketing pages** — see #10.3.

---

## Resolved

### #1 — Schema design gaps to settle before generating Stage 01 migration

Resolved: 2026-04-27 — "Apply revised plan."

Decisions:
1. ✅ Single `users` table satisfies Auth.js + business needs.
2. ✅ Partial unique index on `users.email` where `deleted_at is null`.
3. ✅ `citext` extension (custom SQL migration #2 below).
4. ✅ `bigint` for all `*_cents` columns.
5. ✅ RLS via `current_setting('app.current_user_id')` + `is_admin()` +
   `user_in_org()` / `user_in_case()` SECURITY DEFINER helpers.
6. ✅ Soft-deleted users excluded from RLS via `deleted_at is null`.
7. ✅ Versioned `case_outputs` (`output_version`, `is_current`, `pinned`,
   `row_revision`); pruning job in Stage 11.
8. ✅ `sha256 char(64) not null` on `case_documents` for dedup.
9. ✅ Status state machine enforced in Stage 05 service layer.
10. ✅ `case_events.event_type` is plain text + `lib/event-types.ts`.
11. ✅ `updated_at` trigger noise accepted; counter writes moved to
    `case_compute_ledger`.
12. ✅ Storage path stored as text; backend choice deferred to Stage 06.
13. ✅ Waitlist GDPR delete via manual SQL + audit log entry; Phase 2
    adds self-serve.
14. ✅ Replaced `cases.attorney_id`/`beneficiary_id` with
    `case_participants` junction.
15. ✅ `attorney_profiles.bar_states text[]`; GIN index when search lands.

Plus eight new considerations applied:
- ✅ A. `organizations` + `organization_members`.
- ✅ B. `row_revision` on `users`, `organizations`, `cases`, `case_outputs`.
- ✅ C. Hard-delete pathway documented (#3.10 above).
- ✅ D. `audit_log` (renamed); generic actor.
- ✅ E. `case_events` indexed by `(case_id, created_at)`.
- ✅ F. PII column comments via custom SQL migration.
- ✅ G. `users.timezone` + `users.locale`.
- ✅ H. Long-text in Postgres for now; threshold documented.
- ✅ I. Service-layer query context object — convention noted.
- ✅ J. `prepare: false` on postgres-js for transaction-pooler compat.

JSONB type drift between Drizzle and Zod — closed by linking Drizzle's
`.$type<>()` annotation to the Zod-inferred type in
`server/db/schema/zod/`. Single source of truth: Zod for blob shape,
Drizzle for column metadata.

### #2 — Custom SQL migrations to author

Resolved: 2026-04-29 — all 6 custom migrations authored + applied
(0001_extensions, 0002_citext_columns, 0003_updated_at_trigger,
0004_row_revision_trigger, 0005_rls, 0006_pii_comments, 0008_app_role).
Workflow + per-file rationale lives in `server/db/migrations/README.md`.

### #5 — `case_participants.role` (renamed to #7 above)

(Re-numbered to keep Active section sequential — see Active #7.)

### #6 — `sessions` table grows unbounded

Promoted to Phase-2 backlog #3.12 — not blocking until growth bites.

### `createCallerFactory` async-fn pattern

Resolved: 2026-04-30 — `tests/integration/trpc-server-caller.test.ts`
(3 tests) verifies the thunk pattern in `lib/trpc/server.ts` works
end-to-end through the real DB.
