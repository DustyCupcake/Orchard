ALTER TABLE "recruitment_pair" ALTER COLUMN "requested_by_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_pair" ADD COLUMN "first_arrival_id" uuid;--> statement-breakpoint
ALTER TABLE "recruitment_pair" ADD COLUMN "second_arrival_id" uuid;--> statement-breakpoint
ALTER TABLE "recruitment_pair" ADD COLUMN "linked_by_team" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_pair" ADD CONSTRAINT "recruitment_pair_first_arrival_id_admission_id_fk" FOREIGN KEY ("first_arrival_id") REFERENCES "public"."admission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_pair" ADD CONSTRAINT "recruitment_pair_second_arrival_id_admission_id_fk" FOREIGN KEY ("second_arrival_id") REFERENCES "public"."admission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A pair that already exists is between the arrivals its applications made. One whose application has
-- no arrival yet (it predates arrivals) keeps its response ids until the arrival is made.
UPDATE "recruitment_pair" p SET "first_arrival_id" = (SELECT a.id FROM "admission" a WHERE a.form_response_id = p.first_response_id ORDER BY a.created_at LIMIT 1) WHERE p.first_response_id IS NOT NULL;--> statement-breakpoint
UPDATE "recruitment_pair" p SET "second_arrival_id" = (SELECT a.id FROM "admission" a WHERE a.form_response_id = p.second_response_id ORDER BY a.created_at LIMIT 1) WHERE p.second_response_id IS NOT NULL;
