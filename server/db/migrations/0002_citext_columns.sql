-- Convert email columns from `text` to `citext`.
--
-- Drizzle's TS DSL doesn't ship a `citext` type, so the schema declares the
-- columns as `text` and we switch them here. The partial unique indexes
-- (created in the generated migration) automatically inherit the new type
-- and become case-insensitive.
--
-- Without this: a user signs up via Google as `Jane@x.com`, signs in via
-- Microsoft as `jane@x.com`, and we duplicate them.
--
-- Drizzle's migrator runs each file once (tracked in `__drizzle_migrations`).
-- The `using ::citext` cast is a safety net for hand re-creates.

alter table "users"
  alter column "email" type citext using "email"::citext;

alter table "waitlist_entries"
  alter column "email" type citext using "email"::citext;
