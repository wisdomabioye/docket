-- Per-request DB role for application queries.
--
-- Drizzle's standard connection uses the DB owner role (e.g. `postgres`)
-- which BYPASSES RLS — correct for system code (jobs, admin scripts) but
-- means RLS isn't engaged for regular per-request queries unless we
-- switch roles.
--
-- proxy.ts (Stage 02) wraps every per-request transaction with:
--   set local role app_user;
--   set local app.current_user_id = '<uuid>';
-- app_user has no superuser bit and obeys RLS.
--
-- Idempotent — `do $$ … $$` guards `create role` so re-runs don't error.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;

alter default privileges in schema public
  grant select, insert, update, delete on tables to app_user;
alter default privileges in schema public
  grant usage, select on sequences to app_user;
