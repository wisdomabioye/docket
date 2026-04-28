ALTER TABLE "cases" ADD COLUMN "compute_budget_cents" bigint DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "compute_spent_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "build_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "build_completed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "case_outputs_case_type_version_uniq" ON "case_outputs" USING btree ("case_id","output_type","output_version") WHERE "case_outputs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "cases_build_status_idx" ON "cases" USING btree ("status") WHERE "cases"."status" in ('building', 'draft_ready', 'needs_revision') and "cases"."deleted_at" is null;