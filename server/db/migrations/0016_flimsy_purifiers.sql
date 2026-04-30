DROP INDEX "invoices_attorney_period_uniq";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_attorney_period_uniq" ON "invoices" USING btree ("attorney_id","period_year","period_month") WHERE "invoices"."deleted_at" is null;