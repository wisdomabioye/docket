CREATE TABLE "case_recommenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"full_name" text NOT NULL,
	"relationship" text NOT NULL,
	"title_org" text,
	"email" text,
	"guidance" text,
	"recommender_user_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_recommenders" ADD CONSTRAINT "case_recommenders_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_recommenders" ADD CONSTRAINT "case_recommenders_recommender_user_id_users_id_fk" FOREIGN KEY ("recommender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_recommenders_case_idx" ON "case_recommenders" USING btree ("case_id","display_order") WHERE "case_recommenders"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "case_recommenders_case_order_active_uniq" ON "case_recommenders" USING btree ("case_id","display_order") WHERE "case_recommenders"."deleted_at" is null;