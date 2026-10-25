CREATE TABLE "accompaniment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"arrival_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_on" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"asked_for_someone_else_at" timestamp with time zone,
	"announced_holder_id" uuid
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "accompaniment_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "accompaniment_tier_id" uuid;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "accompaniment_ends_after_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "accompaniment" ADD CONSTRAINT "accompaniment_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accompaniment" ADD CONSTRAINT "accompaniment_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accompaniment" ADD CONSTRAINT "accompaniment_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accompaniment" ADD CONSTRAINT "accompaniment_arrival_id_admission_id_fk" FOREIGN KEY ("arrival_id") REFERENCES "public"."admission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accompaniment" ADD CONSTRAINT "accompaniment_announced_holder_id_member_id_fk" FOREIGN KEY ("announced_holder_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accompaniment_one_open_per_member" ON "accompaniment" USING btree ("member_id") WHERE "accompaniment"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "accompaniment_task_idx" ON "accompaniment" USING btree ("task_id");--> statement-breakpoint
ALTER TABLE "community" ADD CONSTRAINT "community_accompaniment_tier_id_tier_id_fk" FOREIGN KEY ("accompaniment_tier_id") REFERENCES "public"."tier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Carry every accompaniment that already exists. Until now the only record of one was the
-- decision that made its task, so a row is made for each decision that has both a task and
-- the member it is for. The window is the default ninety days from the task's own start; a
-- task already done is an accompaniment already over. The holder as it stands is recorded as
-- already announced, so nobody who has been accompanied for months is emailed "someone has
-- been named".
INSERT INTO "accompaniment" ("community_id", "member_id", "task_id", "arrival_id", "started_at", "ends_on", "ended_at", "announced_holder_id")
SELECT DISTINCT ON (d."converted_member_id")
	m."community_id",
	d."converted_member_id",
	d."accompaniment_task_id",
	d."arrival_id",
	t."created_at",
	t."created_at" + interval '90 days',
	CASE WHEN t."status" = 'done' THEN t."status_changed_at" END,
	(SELECT a."member_id" FROM "task_assignment" a WHERE a."task_id" = t."id" AND a."is_shadow" = false ORDER BY a."claimed_at" LIMIT 1)
FROM "recruitment_decision" d
JOIN "member" m ON m."id" = d."converted_member_id"
JOIN "task" t ON t."id" = d."accompaniment_task_id"
WHERE d."accompaniment_task_id" IS NOT NULL AND d."converted_member_id" IS NOT NULL
ORDER BY d."converted_member_id", t."created_at" DESC
ON CONFLICT DO NOTHING;
