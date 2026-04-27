# Open issues

Tracker for design questions and known gaps. Three sections:

- **Active** — needs decision or action soon (blocks current/next stage)
- **Phase-2 backlog** — known limitations to revisit when scale demands them
- **Resolved** — decisions captured for posterity

---

## Active

### #2 — Custom SQL migrations to author

Status: User action — generate and fill via `pnpm db:generate:custom --name=<name>`.
Owner: user
Surfaced: 2026-04-27

> Full rationale + workflow lives in `server/db/migrations/README.md`. This
> section is the short paste-list. Author in this order so lexical sort
> applies them correctly. (Files 0001–0006 are already authored.)

| # | Name | Purpose |
|---|------|---------|
| 0001 | extensions | pgcrypto, citext, pg_trgm |
| 0002 | citext_columns | alter `users.email`, `waitlist_entries.email` to citext |
| 0003 | updated_at_trigger | auto-touch `updated_at` |
| 0004 | row_revision_trigger | auto-bump `row_revision` for optimistic concurrency |
| 0005 | rls | helpers + enable RLS + per-table policies |
| 0006 | pii_comments | column-level PII / SECRET classification |
| **0008** | **app_role** | **non-superuser role for per-request queries (see snippet below)** |

After your next `pnpm db:generate` produces 0007 with the schema-generated
indexes, run:

```bash
pnpm db:generate:custom --name=app_role
```

Paste this into the new file:

```sql
-- Per-request DB role for application queries.
--
-- Drizzle's standard connection uses the DB owner role (e.g. `postgres`)
-- which BYPASSES RLS — correct for system code (jobs, admin scripts) but
-- means RLS isn't engaged for regular per-request queries unless we
-- switch roles.
--
-- proxy.ts (Stage 02) will wrap every per-request transaction with:
--   set local role app_user;
--   set local app.current_user_id = '<uuid>';
-- app_user has no superuser bit and obeys RLS.

create role app_user nologin;

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;

alter default privileges in schema public
  grant select, insert, update, delete on tables to app_user;
alter default privileges in schema public
  grant usage, select on sequences to app_user;
```

Then `pnpm db:migrate`. Once applied, `pnpm test` runs the RLS canary suite
in `tests/integration/rls.test.ts` (it auto-skips when the role is missing).

---

### #5 — `case_participants.role` consistency with global `user_roles`

Status: Service-layer enforcement; not constrained at DB.
Surfaced: 2026-04-27

A user without the global `attorney` role in `user_roles` can be inserted
into `case_participants` with `role = 'attorney'`. Postgres has no way to
express "the user must hold this global role" without a check function.

**How to apply:** Stage 02's `case.addParticipant` service procedure must
verify `user_roles` membership before insert. If we ever add a third
participant role beyond what global roles cover (e.g., `observer` doesn't
need a global role), document that exception.

---

### #6 — `sessions` table grows unbounded

Status: Phase-2 backlog action — needs a cron job.
Surfaced: 2026-04-27

Auth.js relies on `sessions.expires` for validity but doesn't prune
expired rows. Over time the table grows indefinitely.

**How to apply:** Stage 11 (or earlier if growth bites) ships an Inngest
cron that runs `delete from sessions where expires < now()` daily. Until
then, manual cleanup if the table gets large.

---

### #4 — RLS test coverage is canary-only

Status: Tracked.
Owner: any contributor extending RLS.
Surfaced: 2026-04-27

`tests/integration/rls.test.ts` proves cross-user isolation for the
`users` and `cases` tables. Every other RLS-protected table currently has
no behavioral test — only the policy text in `0005_rls.sql`. As Stage 02+
adds real queries, extend the suite (one happy + one denied test per
new access pattern is the bar).

---

## Phase-2 backlog

### #3 — Phase-2 follow-ups recorded during Stage 01

Items intentionally deferred:

1. **`case_events` partitioning by month** — declarative partitioning becomes
   mechanical once row counts hit ~10M.
2. **`audit_log` partitioning** — same.
3. **`case_outputs.content` to object storage** at >1MB per row.
4. **Output pruning job** — drop unpinned, non-current versions older than
   N days. Stage 11.
5. **Read replicas** for eligibility-engine reads.
6. **GIN index on `attorney_profiles.bar_states`** when state-search becomes
   a feature.
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

---

## Resolved

### #1 — Schema design gaps to settle before generating Stage 01 migration

Resolved: 2026-04-27 — "Apply revised plan."

Decisions:
1. ✅ Single `users` table satisfies Auth.js + business needs.
2. ✅ Partial unique index on `users.email` where `deleted_at is null`.
3. ✅ `citext` extension (custom SQL migration #2 above).
4. ✅ `bigint` for all `*_cents` columns.
5. ✅ RLS via `current_setting('app.current_user_id')` + `is_admin()` +
   `user_in_org()` / `user_in_case()` SECURITY DEFINER helpers.
6. ✅ Soft-deleted users excluded from RLS via `deleted_at is null`.
7. ✅ Versioned `case_outputs` (`output_version`, `is_current`, `pinned`,
   `row_revision`); pruning job in Stage 11.
8. ✅ `sha256 char(64) not null` on `case_documents` for dedup.
9. ✅ Status state machine enforced in Stage 05 service layer.
10. ✅ `case_events.event_type` is plain text + `lib/event-types.ts` (Stage 02).
11. ✅ `updated_at` trigger noise accepted; counter writes moved to
    `case_compute_ledger`.
12. ✅ Storage path stored as text; backend choice deferred to Stage 06.
13. ✅ Waitlist GDPR delete via manual SQL + audit log entry; Phase 2 adds
    self-serve.
14. ✅ Replaced `cases.attorney_id`/`beneficiary_id` with `case_participants`
    junction. Kept `cases.beneficiary_user_id` for direct applicant lookup.
15. ✅ `attorney_profiles.bar_states text[]`; GIN index when search lands.

Plus eight new considerations applied:
- ✅ A. `organizations` + `organization_members`.
- ✅ B. `row_revision` on `users`, `organizations`, `cases`, `case_outputs`.
- ✅ C. Hard-delete pathway documented (#3.10 above).
- ✅ D. `audit_log` (renamed); generic actor.
- ✅ E. `case_events` indexed by `(case_id, created_at)` for partitioning.
- ✅ F. PII column comments via custom SQL migration.
- ✅ G. `users.timezone` + `users.locale`.
- ✅ H. Long-text in Postgres for now; threshold documented.
- ✅ I. Service-layer query context object — convention noted, lands Stage 02.
- ✅ J. `prepare: false` on postgres-js for transaction-pooler compatibility.

JSONB type drift between Drizzle and Zod — closed by linking Drizzle's
`.$type<>()` annotation to the Zod-inferred type in
`server/db/schema/zod/`. Single source of truth: Zod for blob shape,
Drizzle for column metadata.
