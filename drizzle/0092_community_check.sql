CREATE TABLE "community_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"arrival_id" uuid NOT NULL,
	"kind" "community_check_kind" NOT NULL,
	"window_hours" integer NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" "community_check_status" DEFAULT 'open' NOT NULL,
	"standing_concern_count" integer DEFAULT 0 NOT NULL,
	"timer_signaled_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"resolution_note" text,
	"ask_for_more_application" boolean DEFAULT false NOT NULL,
	"ask_for_more_interview" boolean DEFAULT false NOT NULL,
	"asked_for_more_by_id" uuid,
	"asked_for_more_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_check_concern" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"raised_by_id" uuid NOT NULL,
	"note" text NOT NULL,
	"resolution" "community_check_concern_resolution" DEFAULT 'standing' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"resolution_note" text,
	"overrule_supporter_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_check_concern_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concern_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "community_check_concern_exclusion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concern_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"added_by_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_check_overrule_support" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concern_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"note" text NOT NULL,
	"supported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_check" ADD CONSTRAINT "community_check_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern" ADD CONSTRAINT "community_check_concern_check_id_community_check_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."community_check"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern" ADD CONSTRAINT "community_check_concern_raised_by_id_member_id_fk" FOREIGN KEY ("raised_by_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern_consent" ADD CONSTRAINT "community_check_concern_consent_concern_id_community_check_concern_id_fk" FOREIGN KEY ("concern_id") REFERENCES "public"."community_check_concern"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern_consent" ADD CONSTRAINT "community_check_concern_consent_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern_exclusion" ADD CONSTRAINT "community_check_concern_exclusion_concern_id_community_check_concern_id_fk" FOREIGN KEY ("concern_id") REFERENCES "public"."community_check_concern"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern_exclusion" ADD CONSTRAINT "community_check_concern_exclusion_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern_exclusion" ADD CONSTRAINT "community_check_concern_exclusion_added_by_id_member_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_overrule_support" ADD CONSTRAINT "community_check_overrule_support_concern_id_community_check_concern_id_fk" FOREIGN KEY ("concern_id") REFERENCES "public"."community_check_concern"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_overrule_support" ADD CONSTRAINT "community_check_overrule_support_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_check_arrival_unique" ON "community_check" USING btree ("arrival_id");--> statement-breakpoint
CREATE INDEX "community_check_concern_check_id_idx" ON "community_check_concern" USING btree ("check_id");--> statement-breakpoint
CREATE INDEX "community_check_concern_raised_by_idx" ON "community_check_concern" USING btree ("raised_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_check_concern_consent_concern_member_unique" ON "community_check_concern_consent" USING btree ("concern_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_check_concern_exclusion_concern_member_unique" ON "community_check_concern_exclusion" USING btree ("concern_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_check_overrule_support_concern_member_unique" ON "community_check_overrule_support" USING btree ("concern_id","member_id");