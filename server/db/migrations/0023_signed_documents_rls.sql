-- Row-level security for `signed_documents`. Mirrors the
-- `case_recommenders` RLS pattern in 0021 but tightened for an
-- append-only ledger:
--
--   - Self SELECT: a user reads their own un-revoked signatures.
--   - Self INSERT: a user inserts a row for themselves.
--   - Self UPDATE / DELETE: NOT GRANTED. Signatures are append-only;
--     revocation is admin-only via the override policy.
--   - Admin: full access (read history + revoke).
--
-- The application tier never relies solely on RLS — `signature.*`
-- procedures double-check ownership before returning rows or
-- generating download URLs (CLAUDE.md §6.9). RLS is the safety net.
--
-- Idempotent — drops then re-creates each policy.

alter table signed_documents enable row level security;

drop policy if exists signed_documents_self_select on signed_documents;
create policy signed_documents_self_select on signed_documents
  for select
  using (user_id = current_app_user() and revoked_at is null);

drop policy if exists signed_documents_self_insert on signed_documents;
create policy signed_documents_self_insert on signed_documents
  for insert
  with check (user_id = current_app_user());

drop policy if exists signed_documents_admin on signed_documents;
create policy signed_documents_admin on signed_documents
  for all
  using (is_admin())
  with check (is_admin());