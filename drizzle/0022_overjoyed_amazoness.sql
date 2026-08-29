CREATE TABLE "community_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"inviter_thinks_good_fit" boolean DEFAULT false NOT NULL,
	"inviter_knows_personally" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"redeemed_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_invite_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "inquiry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"message" text NOT NULL,
	"contact_info" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_task_id" uuid;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "joined_via_invite_id" uuid;--> statement-breakpoint
ALTER TABLE "community_invite" ADD CONSTRAINT "community_invite_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_invite" ADD CONSTRAINT "community_invite_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_invite" ADD CONSTRAINT "community_invite_redeemed_by_member_id_member_id_fk" FOREIGN KEY ("redeemed_by_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_claimed_by_member_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;