DROP INDEX "case_compute_ledger_case_idx";--> statement-breakpoint
CREATE INDEX "attorney_profiles_status_idx" ON "attorney_profiles" USING btree ("status") WHERE "attorney_profiles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id") WHERE "organization_members"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_stripe_customer_uniq" ON "organizations" USING btree ("stripe_customer_id") WHERE "organizations"."stripe_customer_id" is not null;--> statement-breakpoint
CREATE INDEX "case_compute_ledger_case_occurred_idx" ON "case_compute_ledger" USING btree ("case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "case_documents_extraction_pending_idx" ON "case_documents" USING btree ("extraction_status") WHERE "case_documents"."extraction_status" in ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "case_documents_uploaded_by_idx" ON "case_documents" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "case_events_actor_idx" ON "case_events" USING btree ("actor_user_id","created_at") WHERE "case_events"."actor_user_id" is not null;--> statement-breakpoint
CREATE INDEX "cases_revenue_status_idx" ON "cases" USING btree ("revenue_status") WHERE "cases"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "cases_invoice_idx" ON "cases" USING btree ("invoice_id") WHERE "cases"."invoice_id" is not null;--> statement-breakpoint
CREATE INDEX "waitlist_entries_created_idx" ON "waitlist_entries" USING btree ("created_at");