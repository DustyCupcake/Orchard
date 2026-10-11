ALTER TABLE "evaluation" ALTER COLUMN "form_response_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_decision" ALTER COLUMN "form_response_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluation" ADD COLUMN "arrival_id" uuid;--> statement-breakpoint
ALTER TABLE "recruitment_decision" ADD COLUMN "arrival_id" uuid;--> statement-breakpoint
ALTER TABLE "evaluation" ADD CONSTRAINT "evaluation_arrival_id_admission_id_fk" FOREIGN KEY ("arrival_id") REFERENCES "public"."admission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_decision" ADD CONSTRAINT "recruitment_decision_arrival_id_admission_id_fk" FOREIGN KEY ("arrival_id") REFERENCES "public"."admission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_decision" ADD CONSTRAINT "recruitment_decision_arrival_id_unique" UNIQUE("arrival_id");--> statement-breakpoint
-- Reports and decisions that already exist belong to the arrival their application made. One
-- that has none yet (an application that predates arrivals) is linked when its arrival is made.
UPDATE "evaluation" e SET "arrival_id" = (SELECT a.id FROM "admission" a WHERE a.form_response_id = e.form_response_id ORDER BY a.created_at LIMIT 1) WHERE e.form_response_id IS NOT NULL;--> statement-breakpoint
UPDATE "recruitment_decision" d SET "arrival_id" = (SELECT a.id FROM "admission" a WHERE a.form_response_id = d.form_response_id ORDER BY a.created_at LIMIT 1) WHERE d.form_response_id IS NOT NULL;
