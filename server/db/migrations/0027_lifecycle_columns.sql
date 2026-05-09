-- 0027_lifecycle_columns — ADR-006 Step 1: lifecycle timestamps + USCIS receipt number.
--
-- Three nullable columns on `cases` plus a partial unique index on
-- `filed_receipt_number`. Additive only — no backfill, no destructive
-- changes. Existing rows get NULL for the new columns; the reconciler
-- (added in Step 3) treats NULL as "not yet."
--
-- Note on CONCURRENTLY: ADR-006 calls for `CREATE UNIQUE INDEX
-- CONCURRENTLY`, but `drizzle-kit migrate` runs each migration file
-- inside a single transaction, and Postgres rejects `CONCURRENTLY`
-- inside a transaction. Phase 1 has zero live attorneys, so the brief
-- ACCESS EXCLUSIVE lock taken here is moot. Migrating to a non-tx
-- index pipeline is tracked in open_issues.md (#23) and will land
-- before Phase 2 traffic.
ALTER TABLE "cases" ADD COLUMN "package_compiled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "filed_receipt_number" text;--> statement-breakpoint
CREATE UNIQUE INDEX "cases_filed_receipt_number_uniq" ON "cases" USING btree ("filed_receipt_number") WHERE "cases"."filed_receipt_number" is not null;
