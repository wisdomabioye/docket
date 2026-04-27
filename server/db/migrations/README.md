# Database migrations

This folder is the source of truth for every change to the production
database schema. Drizzle's standard migrator applies every `.sql` file in
this folder in lexical order, tracked via the `__drizzle_migrations` table.

## Two kinds of migrations

### Generated migrations — `pnpm db:generate`

Drizzle Kit reads `server/db/schema/*.ts` and emits SQL for everything its
TypeScript DSL can express:

- Tables, columns, defaults
- Foreign keys, primary keys
- Unique and partial indexes
- pgEnums

If you change a schema TS file, run `pnpm db:generate`. Drizzle writes
`NNNN_<auto-name>.sql` capturing the diff. Commit it.

### Custom migrations — `pnpm db:generate:custom --name=<name>`

Drizzle's TS DSL **cannot** express everything Postgres can. For those,
generate an empty SQL file and write the SQL yourself:

```bash
pnpm db:generate:custom --name=rls
# → creates server/db/migrations/NNNN_rls.sql (empty)
# you fill it in, commit it.
```

Both kinds live side by side. Lexical order is what the migrator uses, so
keep filenames numbered correctly (Drizzle handles the prefix automatically).

## Authoritative list of custom migrations

The schema deliberately leaves these concerns to custom SQL because
expressing them in TS would either (a) be impossible, (b) couple us to
Drizzle internals, or (c) push correctness from the database into
application code where it can be silently bypassed. Each custom migration
below has a **why-this-can't-be-in-TS** so a future developer doesn't
delete it during a refactor.

Author them in this order. Each `pnpm db:generate:custom --name=<name>`
creates an empty file you fill from the snippets in `open_issues.md` #2.

---

### 1. `extensions` — Postgres extensions

```sql
create extension if not exists pgcrypto;   -- (optional; gen_random_uuid is built-in on PG 13+)
create extension if not exists citext;     -- case-insensitive emails
create extension if not exists pg_trgm;    -- fuzzy text search (used in Phase 2)
```

**Why custom:** Drizzle has no `CREATE EXTENSION` DSL. Extensions are a
DBA-level operation; managed Postgres providers (Supabase, Neon, RDS) all
support `create extension if not exists` for these three.

**Why we want it:**
- `citext` powers case-insensitive email uniqueness without app-layer
  normalization. If we drop this, every code path that touches `email`
  must remember to `.toLowerCase()` first — easy to forget; hard to
  audit; user enters `Jane@x.com` then signs in via OAuth that returns
  `jane@x.com` and we duplicate them.
- `pg_trgm` is a Phase 2 dependency for fuzzy attorney/case search.
  Adding it now is free (no objects depend on it until used).

---

### 2. `citext_columns` — alter email columns to citext

```sql
alter table users alter column email type citext using email::citext;
alter table waitlist_entries alter column email type citext using email::citext;
```

**Why custom:** Drizzle ships `text` and a few other base types but not
`citext`. We could declare a custom column type in TS, but that hides the
extension dependency from the schema and makes the diff opaque. An explicit
`alter` is honest about what's happening.

**Must run after `extensions`.** Order is enforced by the lexical sort —
name this file with a higher prefix than `extensions`.

---

### 3. `updated_at_trigger` — automatic `updated_at` maintenance

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

**Why custom:** Drizzle has `.$onUpdate(() => new Date())` which runs in
the app layer — but that only fires when *Drizzle* issues the update. Any
write that bypasses Drizzle (a `psql` session, an admin script, a
maintenance migration, a future microservice) silently leaves `updated_at`
stale. A DB trigger is the only correctness guarantee.

**Why we want it:** `updated_at` powers ETag generation, "modified since"
queries, and audit timelines. Stale values corrupt all three.

---

### 4. `row_revision_trigger` — optimistic concurrency token

```sql
create or replace function bump_row_revision() returns trigger
language plpgsql as $$
begin new.row_revision = old.row_revision + 1; return new; end; $$;

-- attach to: users, organizations, cases, case_outputs
```

**Why custom:** Same reasoning as `updated_at`. The service layer does
`update ... where id = ? and row_revision = ?` to detect concurrent edits;
that check only works if every write — including out-of-band ones —
increments the counter.

**Why we want it:** Two attorneys editing the same case from two tabs.
Without revision checks, the slower save silently overwrites the faster
one.

---

### 5. `rls` — row-level security

```sql
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

alter table users enable row level security;
-- ... every table

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

**Why custom:** Drizzle has no RLS DSL.

**Why we want it:** This is the **safety net** per `CLAUDE.md` §6.9.
Application-layer authorization is the gate — RLS catches the bugs we
miss. At consumer scale (Phase 2, 100k+ users), one missed `where userId =`
in a service function exposes everyone's data; RLS blocks it at the DB.
At Phase 1 scale (tens of users) the risk is smaller but the cost of
adding RLS is the same — better to set it up before there's data to leak.

**Stage 02 wires the GUC.** Until the tRPC middleware sets
`set local app.current_user_id = '<uuid>'` per request, every policy
evaluates `current_app_user()` as `null` and effectively denies all access.
That's fine — RLS is dormant until auth lands. Authoring it now means
Stage 02 just turns it on.

---

### 6. `pii_comments` — column-level data classification

```sql
comment on column users.email is 'PII:high';
comment on column users.name is 'PII:medium';
comment on column users.image is 'PII:low';
comment on column waitlist_entries.email is 'PII:high';
comment on column case_documents.original_filename is 'PII:medium';
comment on column case_documents.extracted_text is 'PII:high';
comment on column case_outputs.content is 'PII:high';
comment on column case_outputs.metadata is 'PII:high';
comment on column cases.beneficiary_data is 'PII:high';
```

**Why custom:** Drizzle has no `COMMENT ON` DSL.

**Why we want it:** SOC 2 / GDPR audits need a column inventory of every
piece of personal data we store. Without this, the inventory is a tribal
knowledge problem. With this, it's one query:

```sql
select c.table_name, c.column_name, pgd.description
from information_schema.columns c
join pg_catalog.pg_statio_all_tables st
  on st.schemaname = c.table_schema and st.relname = c.table_name
join pg_catalog.pg_description pgd
  on pgd.objoid = st.relid and pgd.objsubid = c.ordinal_position
where pgd.description like 'PII:%';
```

A Phase 2 task automates this into a CSV (open_issues #3.7).

---

## Workflow cheat sheet

| You change | You run |
|---|---|
| `server/db/schema/*.ts` | `pnpm db:generate` (commit the new SQL file) |
| Need extension / trigger / RLS / function / comment | `pnpm db:generate:custom --name=<short>` then write the SQL |
| Apply everything to the database | `pnpm db:migrate` |
| Inspect schema visually | `pnpm db:studio` |

**Never edit a generated migration after committing.** If the schema is
wrong, change the TS and run `pnpm db:generate` again — the diff produces
a new migration file. Editing existing migrations breaks anyone who
already applied them.

**Never delete migrations.** The `__drizzle_migrations` table records
what's been run; removing a file makes new clones think they need to apply
something that already exists.

## Why migrations live with code, not in a separate repo

Schema is part of the application contract. Co-locating it means PR review
sees the schema diff alongside the code that depends on it; CI can
typecheck both together; a single git revert undoes both. The cost is
that infra-style changes (RLS, partitions) ride the same review process
as feature work — that's the right trade.
