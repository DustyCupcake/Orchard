CREATE TABLE "cycle_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_source_cycle_id" uuid
);
--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "cycle_type_id" uuid;--> statement-breakpoint
ALTER TABLE "cycle_type" ADD CONSTRAINT "cycle_type_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_cycle_type_id_cycle_type_id_fk" FOREIGN KEY ("cycle_type_id") REFERENCES "public"."cycle_type"("id") ON DELETE no action ON UPDATE no action;