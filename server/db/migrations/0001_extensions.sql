-- Postgres extensions used by Phase 1.
--
-- pgcrypto: Drizzle's `defaultRandom()` emits `gen_random_uuid()`. PG 13+
--           ships this built-in but the explicit extension is harmless and
--           keeps older managed providers happy.
-- citext:   case-insensitive text type for emails (see 0002).
-- pg_trgm:  trigram indexes for fuzzy search (Phase 2).
--
-- Idempotent — safe to re-run.

create extension if not exists "pgcrypto";
create extension if not exists "citext";
create extension if not exists "pg_trgm";
