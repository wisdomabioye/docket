-- Stage 10: row-level security for the `invoices` table.
--
-- Same pattern as 0005_rls.sql: per-row policy gated on the
-- `app.current_user_id` GUC, plus an `is_admin()` blanket policy.
-- Service-side writes (createMonthlyInvoice, webhook handlers) run
-- through `ownerDb` and bypass RLS — that's deliberate; mark/finalize
-- flows happen outside any user context. Per-request reads (the
-- attorney's own billing list) go through `ctx.db` and ARE gated.
--
-- Idempotent — drops then re-creates each policy.

alter table invoices enable row level security;

-- Attorney can read/insert their own invoice rows. Inserts also gated
-- by `attorney_id = current_app_user()` so a forged client request
-- can't poison another attorney's billing rollup. We don't allow
-- update/delete from the attorney path; admin/system-only.
drop policy if exists invoices_self_read on invoices;
create policy invoices_self_read on invoices for select
  using (attorney_id = current_app_user());

drop policy if exists invoices_self_insert on invoices;
create policy invoices_self_insert on invoices for insert
  with check (attorney_id = current_app_user());

drop policy if exists invoices_admin on invoices;
create policy invoices_admin on invoices for all
  using (is_admin()) with check (is_admin());
