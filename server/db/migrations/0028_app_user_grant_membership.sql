-- 0028_app_user_grant_membership: grant the connecting role membership
-- in `app_user` so per-request `SET LOCAL ROLE app_user` (server/proxy.ts)
-- works in managed-Postgres environments.
--
-- Why custom: `0008_app_role.sql` creates `app_user` and grants table
-- privileges to it, but does NOT make the connecting role a member.
-- That works locally (the dev `postgres` is a superuser; superusers
-- can `SET ROLE` to any role unconditionally). It does NOT work on
-- Supabase, Neon, RDS, etc. — their `postgres` role has had the
-- superuser bit removed and was never granted membership in our
-- custom `app_user`. Without this grant, `proxy.ts` raises
-- SQLSTATE 42501 (`permission denied to set role "app_user"`)
-- on every authed request.
--
-- The fix is one statement: GRANT app_user TO <connecting_role>.
-- We auto-detect `current_user` so this works across environments
-- without env-specific SQL — locally `postgres` (no-op since
-- superusers implicitly satisfy the membership check, but the GRANT
-- is harmless), on Supabase `postgres` (the role bound to
-- DATABASE_URL whether direct or pooled), in CI whatever role the
-- migrator runs as.
--
-- Idempotent — `pg_has_role` short-circuits when membership is
-- already in place. Safe to re-run.

DO $$
DECLARE
  connecting_role text := current_user;
BEGIN
  IF connecting_role <> 'app_user'
     AND NOT pg_has_role(connecting_role, 'app_user', 'MEMBER')
  THEN
    EXECUTE format('GRANT app_user TO %I', connecting_role);
  END IF;
END $$;
