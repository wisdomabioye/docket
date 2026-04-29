CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attorney_id" uuid NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"status" text NOT NULL,
	"hosted_invoice_url" text,
	"last_failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" IN ('draft','open','paid','void','uncollectible'))
);
--> statement-breakpoint
ALTER TABLE "attorney_profiles" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_attorney_id_users_id_fk" FOREIGN KEY ("attorney_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_attorney_period_uniq" ON "invoices" USING btree ("attorney_id","period_year","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_stripe_id_uniq" ON "invoices" USING btree ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_attorney_created_idx" ON "invoices" USING btree ("attorney_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");
--> statement-breakpoint

-- Stage 10: cases.invoice_id was added in Stage 1 as a forward-compat
-- nullable uuid; the actual FK couldn't land until the invoices table
-- existed. Add the constraint here. ON DELETE SET NULL so deleting an
-- invoice (rare admin op) doesn't cascade-orphan cases — those cases
-- just lose their invoice link and surface as "uninvoiced" again.
ALTER TABLE "cases"
  ADD CONSTRAINT "cases_invoice_id_invoices_id_fk"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL;
