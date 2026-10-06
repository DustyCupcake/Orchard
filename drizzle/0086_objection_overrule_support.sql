CREATE TABLE "objection_overrule_support" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"objection_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"note" text NOT NULL,
	"supported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "objection_overrule_support" ADD CONSTRAINT "objection_overrule_support_objection_id_objection_id_fk" FOREIGN KEY ("objection_id") REFERENCES "public"."objection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objection_overrule_support" ADD CONSTRAINT "objection_overrule_support_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "objection_overrule_support_objection_id_member_id_unique" ON "objection_overrule_support" USING btree ("objection_id","member_id");