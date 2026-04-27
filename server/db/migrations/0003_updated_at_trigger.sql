-- Auto-update `updated_at` on every row update.
--
-- We could do this in app code (Drizzle has `.$onUpdate(() => new Date())`),
-- but a DB trigger is the only correctness guarantee — any out-of-band
-- write (psql session, admin script, future microservice) would otherwise
-- leave `updated_at` stale and silently corrupt ETags / "modified since"
-- queries / audit timelines.
--
-- Attached to every table with an `updated_at` column. Tables without it
-- (event/ledger/audit logs, user_roles, Auth.js tables) are skipped.
--
-- Idempotent — drops then re-creates each trigger.

create or replace function set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
  tables text[] := array[
    'users',
    'attorney_profiles',
    'organizations',
    'organization_members',
    'cases',
    'case_participants',
    'case_documents',
    'case_outputs'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists trg_%I_updated_at on %I', t, t);
    execute format(
      'create trigger trg_%I_updated_at
         before update on %I
         for each row execute function set_updated_at()',
      t, t);
  end loop;
end $$;
