CREATE TABLE "placement_revert_notice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"placement_id" uuid NOT NULL,
	"recipient_member_id" uuid NOT NULL,
	"reverted_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "placement_revert_notice" ADD CONSTRAINT "placement_revert_notice_placement_id_placement_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_revert_notice" ADD CONSTRAINT "placement_revert_notice_recipient_member_id_member_id_fk" FOREIGN KEY ("recipient_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_revert_notice" ADD CONSTRAINT "placement_revert_notice_reverted_by_member_id_fk" FOREIGN KEY ("reverted_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;