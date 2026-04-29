-- Stage 10 audit follow-ups.
--
-- (1) Soft-delete column on `invoices` to match CLAUDE.md §6.8 ("All
--     tables have `deleted_at TIMESTAMPTZ`"). Stage 10 shipped without
--     it; webhook void uses `status='void'` for the audit trail, but the
--     soft-delete pattern still applies for the rare admin-removes-
--     entirely path.
--
-- (2) Replace the `(attorney, year, month)` unique index with a partial
--     one filtered to `deleted_at IS NULL` so a soft-deleted invoice
--     row doesn't permanently block re-generation for that period.
--
-- (3) Drop `invoices_self_insert` policy — dead surface. No code path
--     inserts via per-request `ctx.db`; `createMonthlyInvoice` always
--     uses `ownerDb` (RLS bypassed). The policy let an attorney craft
--     own-id rows with no functional purpose; tightening the surface.
--
-- All idempotent.

alter table invoices add column if not exists deleted_at timestamptz;

drop index if exists invoices_attorney_period_uniq;
create unique index invoices_attorney_period_uniq
  on invoices (attorney_id, period_year, period_month)
  where deleted_at is null;

drop policy if exists invoices_self_insert on invoices;
