-- Row-level security.
--
-- Defense-in-depth per CLAUDE.md §6.9: app-layer authorization is the gate;
-- RLS catches missed `where userId = ?` clauses. Stage 02 wires the per-
-- request session GUC `app.current_user_id`. Until that lands, every
-- policy evaluates `current_app_user()` as NULL and effectively denies all
-- access — so the app continues to read/write through Drizzle (which uses
-- the DB owner role and bypasses RLS) until proxy.ts sets the GUC.
--
-- Auth.js tables (accounts, sessions, verification_tokens) are NOT RLS-
-- protected: the Auth.js adapter manages them with the DB owner role and
-- never exposes them through user-facing queries.
--
-- Membership / participation lookups go through SECURITY DEFINER helpers
-- (user_in_org, user_in_case, user_is_case_primary). This bypasses RLS in
-- the helper itself and avoids recursive RLS evaluation when policies
-- reference protected tables.
--
-- Idempotent — drops policies then re-creates; uses `if exists` everywhere.

-- ── Helpers ──────────────────────────────────────────────────────────────

create or replace function current_app_user() returns uuid
  language sql stable as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles
    where user_id = current_app_user()
      and role = 'admin'
  );
$$;

create or replace function user_in_org(_org_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members
    where organization_id = _org_id
      and user_id = current_app_user()
      and removed_at is null
  );
$$;

create or replace function user_in_case(_case_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from case_participants
    where case_id = _case_id
      and user_id = current_app_user()
      and removed_at is null
  );
$$;

create or replace function user_is_case_primary(_case_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from case_participants
    where case_id = _case_id
      and user_id = current_app_user()
      and is_primary
      and removed_at is null
  );
$$;

-- ── Enable RLS on every business table ──────────────────────────────────

alter table users enable row level security;
alter table user_roles enable row level security;
alter table attorney_profiles enable row level security;
alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table cases enable row level security;
alter table case_participants enable row level security;
alter table case_documents enable row level security;
alter table case_outputs enable row level security;
alter table case_events enable row level security;
alter table case_compute_ledger enable row level security;
alter table audit_log enable row level security;
alter table waitlist_entries enable row level security;

-- ── Policies ─────────────────────────────────────────────────────────────

-- users: read/update self; admins everything.
drop policy if exists users_self on users;
create policy users_self on users for all
  using (id = current_app_user() and deleted_at is null)
  with check (id = current_app_user() and deleted_at is null);

drop policy if exists users_admin on users;
create policy users_admin on users for all using (is_admin()) with check (is_admin());

-- user_roles: read own roles; admins all.
drop policy if exists user_roles_self on user_roles;
create policy user_roles_self on user_roles for select
  using (user_id = current_app_user());

drop policy if exists user_roles_admin on user_roles;
create policy user_roles_admin on user_roles for all using (is_admin()) with check (is_admin());

-- attorney_profiles: own profile; admins all.
drop policy if exists attorney_profiles_self on attorney_profiles;
create policy attorney_profiles_self on attorney_profiles for all
  using (user_id = current_app_user() and deleted_at is null)
  with check (user_id = current_app_user() and deleted_at is null);

drop policy if exists attorney_profiles_admin on attorney_profiles;
create policy attorney_profiles_admin on attorney_profiles for all
  using (is_admin()) with check (is_admin());

-- organizations: any active member can read/write; admins all.
drop policy if exists organizations_member on organizations;
create policy organizations_member on organizations for all
  using (deleted_at is null and user_in_org(id))
  with check (deleted_at is null and user_in_org(id));

drop policy if exists organizations_admin on organizations;
create policy organizations_admin on organizations for all
  using (is_admin()) with check (is_admin());

-- organization_members: any peer member can see; admins all.
drop policy if exists organization_members_peer on organization_members;
create policy organization_members_peer on organization_members for select
  using (removed_at is null and user_in_org(organization_id));

drop policy if exists organization_members_admin on organization_members;
create policy organization_members_admin on organization_members for all
  using (is_admin()) with check (is_admin());

-- cases: any case participant; admins all.
drop policy if exists cases_participant on cases;
create policy cases_participant on cases for all
  using (deleted_at is null and user_in_case(id))
  with check (deleted_at is null and user_in_case(id));

drop policy if exists cases_admin on cases;
create policy cases_admin on cases for all using (is_admin()) with check (is_admin());

-- case_participants: peer participants on the same case (read); the case's
-- primary attorney can add new participants; admins all. Updates / removes
-- are admin-only via RLS — service layer enforces "only the primary can
-- remove peers" since RLS can't easily check the existing row vs. the
-- requesting user.
drop policy if exists case_participants_peer on case_participants;
create policy case_participants_peer on case_participants for select
  using (removed_at is null and user_in_case(case_id));

drop policy if exists case_participants_primary_insert on case_participants;
create policy case_participants_primary_insert on case_participants for insert
  with check (user_is_case_primary(case_id));

drop policy if exists case_participants_admin on case_participants;
create policy case_participants_admin on case_participants for all
  using (is_admin()) with check (is_admin());

-- case_documents: via parent case; admins all.
drop policy if exists case_documents_participant on case_documents;
create policy case_documents_participant on case_documents for all
  using (deleted_at is null and user_in_case(case_id))
  with check (deleted_at is null and user_in_case(case_id));

drop policy if exists case_documents_admin on case_documents;
create policy case_documents_admin on case_documents for all
  using (is_admin()) with check (is_admin());

-- case_outputs: via parent case; admins all.
drop policy if exists case_outputs_participant on case_outputs;
create policy case_outputs_participant on case_outputs for all
  using (deleted_at is null and user_in_case(case_id))
  with check (deleted_at is null and user_in_case(case_id));

drop policy if exists case_outputs_admin on case_outputs;
create policy case_outputs_admin on case_outputs for all
  using (is_admin()) with check (is_admin());

-- case_events: read via parent case; only admins/system write. System code
-- runs as DB owner (no GUC set) → RLS bypassed → writes succeed.
drop policy if exists case_events_participant_read on case_events;
create policy case_events_participant_read on case_events for select
  using (user_in_case(case_id));

drop policy if exists case_events_admin on case_events;
create policy case_events_admin on case_events for all
  using (is_admin()) with check (is_admin());

-- case_compute_ledger: read via parent case; only admins/system write.
drop policy if exists case_compute_ledger_participant_read on case_compute_ledger;
create policy case_compute_ledger_participant_read on case_compute_ledger for select
  using (user_in_case(case_id));

drop policy if exists case_compute_ledger_admin on case_compute_ledger;
create policy case_compute_ledger_admin on case_compute_ledger for all
  using (is_admin()) with check (is_admin());

-- audit_log: admin only. Service code writes via the DB owner role.
drop policy if exists audit_log_admin on audit_log;
create policy audit_log_admin on audit_log for all
  using (is_admin()) with check (is_admin());

-- waitlist_entries: anyone can insert (incl. unauthenticated); admins read/edit.
drop policy if exists waitlist_entries_insert on waitlist_entries;
create policy waitlist_entries_insert on waitlist_entries for insert with check (true);

drop policy if exists waitlist_entries_admin on waitlist_entries;
create policy waitlist_entries_admin on waitlist_entries for all
  using (is_admin()) with check (is_admin());
