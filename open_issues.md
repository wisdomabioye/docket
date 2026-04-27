# Open issues

Tracker for design questions and known gaps that surface during the build.
Newest at top. When an issue resolves, move it under `## Resolved` with the
decision and date.

---

## Open

### #2 — Custom SQL migrations to author next

Status: User action — generate and fill in via `pnpm db:generate:custom --name=<name>`.
Owner: user
Surfaced: 2026-04-27 (Stage 01)

The Drizzle-generated SQL covers tables, columns, FKs, indexes, defaults,
enums. Everything below is **not** expressible in Drizzle's TS DSL and must
be hand-written in custom migration files. Each item below is one
`pnpm db:generate:custom --name=...` invocation (creates an empty SQL file
in `server/db/migrations/` you fill in). Order matters — author them in
this order so the lexical sort applies them correctly:

1. **`extensions`** — first migration after the generated tables.
   ```sql
   create extension if not exists pgcrypto;
   create extension if not exists citext;
   create extension if not exists pg_trgm;
   ```

2. **`citext_columns`** — alter email columns to `citext`. Drizzle stores
   them as `text` initially; this changes the underlying type so the
   partial unique index becomes case-insensitive.
   ```sql
   alter table users alter column email type citext using email::citext;
   alter table waitlist_entries alter column email type citext using email::citext;
   ```

3. **`updated_at_trigger`** — single trigger function attached to every
   table with `updated_at`.
   ```sql
   create or replace function set_updated_at() returns trigger
   language plpgsql as $$
   begin new.updated_at = now(); return new; end; $$;

   do $$
   declare t text;
   begin
     for t in select unnest(array[
       'users','attorney_profiles','organizations','organization_members',
       'cases','case_participants','case_documents','case_outputs'
     ]) loop
       execute format('drop trigger if exists trg_%I_updated_at on %I', t, t);
       execute format('create trigger trg_%I_updated_at before update on %I
         for each row execute function set_updated_at()', t, t);
     end loop;
   end $$;
   ```

4. **`row_revision_trigger`** — auto-increment `row_revision` on update.
   Lets the service layer do optimistic concurrency without trusting clients.
   ```sql
   create or replace function bump_row_revision() returns trigger
   language plpgsql as $$
   begin new.row_revision = old.row_revision + 1; return new; end; $$;

   -- attach to: users, organizations, cases, case_outputs
   ```

5. **`rls`** — enable row-level security and define policies. RLS uses a
   per-request session GUC instead of Supabase's `auth.uid()`. Stage 02
   middleware sets `app.current_user_id` per request.
   ```sql
   -- helpers
   create or replace function current_app_user() returns uuid
   language sql stable as $$
     select nullif(current_setting('app.current_user_id', true), '')::uuid;
   $$;

   create or replace function is_admin() returns boolean
   language sql stable security definer set search_path = public as $$
     select exists (
       select 1 from user_roles
       where user_id = current_app_user() and role = 'admin'
     );
   $$;

   -- enable on every table
   alter table users enable row level security;
   alter table user_roles enable row level security;
   -- … etc for every table

   -- policy examples
   create policy users_self on users for all
     using (id = current_app_user() and deleted_at is null);
   create policy users_admin on users for all using (is_admin());

   create policy cases_participant on cases for all using (
     deleted_at is null and exists (
       select 1 from case_participants p
       where p.case_id = cases.id
         and p.user_id = current_app_user()
         and p.removed_at is null
     )
   );
   create policy cases_admin on cases for all using (is_admin());
   ```

6. **`pii_comments`** — column-level data classification for SOC 2 / GDPR.
   ```sql
   comment on column users.email is 'PII:high';
   comment on column users.name is 'PII:medium';
   comment on column users.image is 'PII:low';
   comment on column waitlist_entries.email is 'PII:high';
   comment on column waitlist_entries.name is 'PII:medium';
   comment on column waitlist_entries.ip_address is 'PII:medium';
   comment on column case_documents.original_filename is 'PII:medium';
   comment on column case_documents.extracted_text is 'PII:high';
   comment on column case_outputs.content is 'PII:high';
   comment on column case_outputs.metadata is 'PII:high';
   comment on column cases.beneficiary_data is 'PII:high';
   ```

   Inventory query: `select table_name, column_name, col_description from
   information_schema.columns join pg_description ...`.

Once authored: `pnpm db:migrate` applies all of them in lexical order
through Drizzle's standard migrator.

---

### #3 — Phase-2 follow-ups recorded during Stage 01

Status: Tracked, no action.
Surfaced: 2026-04-27

Items intentionally deferred but worth remembering:

1. **`case_events` partitioning by month** — table will be the largest;
   declarative partitioning is mechanical once row counts hit ~10M.
2. **`audit_log` partitioning** — same.
3. **`case_outputs.content` to object storage** at >1MB per row.
4. **Output pruning job** — drop unpinned, non-current versions older than
   N days. Stage 11.
5. **Read replicas** for eligibility-engine reads (Phase 2).
6. **GIN index on `attorney_profiles.bar_states`** when state-search becomes
   a feature.
7. **PII inventory script** — emits a CSV of tagged columns.
8. **Slug reserved-word blocklist** for `organizations.slug`.

---

## Resolved

### #1 — Schema design gaps to settle before generating Stage 01 migration

Resolved: 2026-04-27 — "Apply revised plan."

Decisions:
1. ✅ Single `users` table satisfies Auth.js + business needs.
2. ✅ Partial unique index on `users.email` where `deleted_at is null`.
3. ✅ `citext` extension (custom SQL migration #2 in issue #2 above).
4. ✅ `bigint` for all `*_cents` columns.
5. ✅ RLS via `current_setting('app.current_user_id')` + `is_admin()`
   (custom SQL migration #5).
6. ✅ Soft-deleted users excluded from RLS via `deleted_at is null` in
   policies.
7. ✅ Versioned `case_outputs` (`output_version`, `is_current`, `pinned`,
   `row_revision`); pruning job in Stage 11.
8. ✅ `sha256 char(64) not null` on `case_documents` for dedup.
9. ✅ Status state machine enforced in Stage 05 service layer.
10. ✅ `case_events.event_type` is plain text + `lib/event-types.ts` (Stage 02).
11. ✅ `updated_at` trigger noise accepted; counter writes moved to
    `case_compute_ledger` so they don't churn `cases.updated_at`.
12. ✅ Storage path stored as text; backend choice deferred to Stage 06.
13. ✅ Waitlist GDPR delete via manual SQL + audit log entry; Phase 2 adds
    self-serve.
14. ✅ Replaced `cases.attorney_id`/`beneficiary_id` with
    `case_participants` junction. Kept `cases.beneficiary_user_id`
    (nullable) for fast direct lookup of the applicant.
15. ✅ `attorney_profiles.bar_states text[]`; GIN index when search lands.

Plus the eight new considerations applied:
- ✅ A. `organizations` + `organization_members`.
- ✅ B. `row_revision` on `users`, `organizations`, `cases`, `case_outputs`.
- ✅ C. Hard-delete pathway documented (function stub Stage 09).
- ✅ D. `audit_log` (renamed from `admin_audit_log`); generic actor.
- ✅ E. `case_events` indexed by `(case_id, created_at)` for partitioning.
- ✅ F. PII column comments via custom SQL migration.
- ✅ G. `users.timezone` + `users.locale`.
- ✅ H. Long-text in Postgres for now; threshold documented for moving out.
- ✅ I. Service-layer query context object — convention noted, lands Stage 02.
- ✅ J. `prepare: false` on postgres-js for transaction-pooler compatibility.
