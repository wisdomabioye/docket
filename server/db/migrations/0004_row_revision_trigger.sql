-- Auto-increment `row_revision` on every row update.
--
-- Service layer does optimistic concurrency:
--   update X set ... where id = ? and row_revision = ?
-- The check only works if EVERY write — including out-of-band ones —
-- bumps the counter. Hence DB-level enforcement.
--
-- Without this: two attorneys editing the same case from two tabs; the
-- slower save silently overwrites the faster one.
--
-- Attached only to tables that declare a `row_revision` column.
--
-- Idempotent — drops then re-creates.

create or replace function bump_row_revision() returns trigger
  language plpgsql as $$
begin
  new.row_revision = old.row_revision + 1;
  return new;
end;
$$;

do $$
declare
  t text;
  tables text[] := array[
    'users',
    'organizations',
    'cases',
    'case_outputs'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists trg_%I_row_revision on %I', t, t);
    execute format(
      'create trigger trg_%I_row_revision
         before update on %I
         for each row execute function bump_row_revision()',
      t, t);
  end loop;
end $$;
