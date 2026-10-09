CREATE TABLE "admission_support" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arrival_id" uuid NOT NULL,
	"supporter_id" uuid NOT NULL,
	"knows_personally" boolean DEFAULT false NOT NULL,
	"thinks_good_fit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A NOT NULL column with no default fails on a table that already has rows, so it
-- is added empty, filled for every existing arrival with a token of its own
-- (gen_random_uuid is cryptographically random; two of them is 244 bits), and
-- only then made required.
ALTER TABLE "admission" ADD COLUMN "support_token" text;--> statement-breakpoint
UPDATE "admission" SET "support_token" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');--> statement-breakpoint
ALTER TABLE "admission" ALTER COLUMN "support_token" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "admission_support" ADD CONSTRAINT "admission_support_arrival_id_admission_id_fk" FOREIGN KEY ("arrival_id") REFERENCES "public"."admission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_support" ADD CONSTRAINT "admission_support_supporter_id_member_id_fk" FOREIGN KEY ("supporter_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_support_arrival_supporter_unique" ON "admission_support" USING btree ("arrival_id","supporter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_support_token_idx" ON "admission" USING btree ("support_token");