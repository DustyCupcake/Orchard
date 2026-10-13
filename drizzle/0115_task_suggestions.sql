CREATE TYPE "public"."task_suggestion_reason" AS ENUM('said_yes', 'invited', 'supported', 'proposed', 'shadowed', 'suggested');--> statement-breakpoint
CREATE TABLE "task_suggestion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"reason" "task_suggestion_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT "task_suggested_member_id_member_id_fk";
--> statement-breakpoint
ALTER TABLE "task_suggestion" ADD CONSTRAINT "task_suggestion_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_suggestion" ADD CONSTRAINT "task_suggestion_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_suggestion_task_member_reason_unique" ON "task_suggestion" USING btree ("task_id","member_id","reason");--> statement-breakpoint
-- Carry what is there. The old column held one person and no reason, so the reason is the
-- nearest honest one: an accompaniment task's suggestion was always the newcomer's inviter, and
-- anything else is simply "suggested". Done before the column goes.
INSERT INTO "task_suggestion" ("task_id", "member_id", "reason")
SELECT t."id", t."suggested_member_id",
	CASE WHEN EXISTS (SELECT 1 FROM "accompaniment" a WHERE a."task_id" = t."id") THEN 'invited'::"task_suggestion_reason" ELSE 'suggested'::"task_suggestion_reason" END
FROM "task" t
WHERE t."suggested_member_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN "suggested_member_id";