DROP INDEX "case_outputs_current_uniq";--> statement-breakpoint
DROP INDEX "case_outputs_case_type_version_uniq";--> statement-breakpoint
ALTER TABLE "case_outputs" ADD COLUMN "subgroup_key" text;--> statement-breakpoint
ALTER TABLE "case_outputs" ADD COLUMN "content_html" text;--> statement-breakpoint
ALTER TABLE "case_outputs" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "case_outputs" ADD COLUMN "attorney_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "case_outputs" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "case_outputs" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "case_outputs" ADD COLUMN "approval_notes" text;--> statement-breakpoint
ALTER TABLE "case_outputs" ADD CONSTRAINT "case_outputs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_outputs_approved_idx" ON "case_outputs" USING btree ("case_id") WHERE "case_outputs"."attorney_approved" = true and "case_outputs"."is_current" = true and "case_outputs"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN "evidence_plan";--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN "criteria_analysis";--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN "document_checklist";--> statement-breakpoint

-- Stage 08 / open_issues #20: subgroup-aware uniqueness for `case_outputs`.
-- COALESCE(subgroup_key, '') collapses NULL into the same uniqueness
-- bucket as a defaulted-empty value, so single-instance output types
-- (where subgroup_key stays NULL) still get exactly one current row
-- per (case, type), while `recommendation_letter_template` rows with
-- distinct recommender ids occupy distinct buckets.
--
-- Drizzle's index DSL doesn't model expression indexes (COALESCE), so
-- these live in a custom-SQL migration. The Drizzle introspector will
-- treat them as opaque external indexes.
CREATE UNIQUE INDEX "case_outputs_current_subgroup_uniq"
  ON "case_outputs" ("case_id", "output_type", COALESCE("subgroup_key", ''))
  WHERE "is_current" = true AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "case_outputs_subgroup_version_uniq"
  ON "case_outputs" ("case_id", "output_type", COALESCE("subgroup_key", ''), "output_version")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- Self-referencing FK on `parent_id` lets us rebuild the version graph
-- (Stage 08 "restore prior version" UI). Drizzle's `.references()` chain
-- can't model self-references in `pg-core` without a circular hack;
-- emit the constraint here instead. ON DELETE SET NULL so soft-deleting
-- a parent doesn't cascade-orphan its derivative versions.
ALTER TABLE "case_outputs"
  ADD CONSTRAINT "case_outputs_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "case_outputs"("id") ON DELETE SET NULL;
