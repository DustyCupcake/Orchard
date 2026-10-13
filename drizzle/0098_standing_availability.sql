CREATE TABLE "recruitment_standing_availability" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"available_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recruitment_standing_availability" ADD CONSTRAINT "recruitment_standing_availability_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;