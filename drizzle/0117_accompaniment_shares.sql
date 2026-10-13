ALTER TABLE "accompaniment" ADD COLUMN "shares_axes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accompaniment" ADD COLUMN "shares_contribution" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accompaniment" ADD COLUMN "shared_with_member_id" uuid;--> statement-breakpoint
ALTER TABLE "accompaniment" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accompaniment" ADD CONSTRAINT "accompaniment_shared_with_member_id_member_id_fk" FOREIGN KEY ("shared_with_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;