-- Stage 11 fix: row-level security + updated_at trigger for
-- `case_recommenders`. Same pattern as `case_documents` /
-- `case_outputs` in 0005_rls.sql — participant-scoped access via
-- `user_in_case`, blanket admin override.
--
-- Drizzle's auto-generated 0020 migration creates the table + indexes
-- but doesn't know about RLS or our shared triggers. Both bits land
-- here as a custom migration so they ship in the same PR as the
-- table.
--
-- Idempotent — drops then re-creates each policy / trigger.

alter table case_recommenders enable row level security;

drop policy if exists case_recommenders_participant on case_recommenders;
create policy case_recommenders_participant on case_recommenders for all
  using (deleted_at is null and user_in_case(case_id))
  with check (deleted_at is null and user_in_case(case_id));

drop policy if exists case_recommenders_admin on case_recommenders;
create policy case_recommenders_admin on case_recommenders for all
  using (is_admin()) with check (is_admin());

-- updated_at trigger — mirrors 0003.
drop trigger if exists trg_case_recommenders_updated_at on case_recommenders;
create trigger trg_case_recommenders_updated_at
  before update on case_recommenders
  for each row execute function set_updated_at();
