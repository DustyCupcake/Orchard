CREATE TYPE "public"."community_check_concern_resolution" AS ENUM('standing', 'cleared', 'upheld', 'overruled', 'withdrawn', 'asked_for_more', 'moot');--> statement-breakpoint
CREATE TYPE "public"."community_check_ended_as" AS ENUM('quiet', 'cleared', 'overruled', 'upheld', 'asked_for_more', 'closed');--> statement-breakpoint
CREATE TYPE "public"."community_check_kind" AS ENUM('entry', 'evaluation');--> statement-breakpoint
CREATE TYPE "public"."community_check_on_quiet" AS ENUM('continue', 'admit', 'decline');--> statement-breakpoint
CREATE TABLE "community_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"arrival_id" uuid NOT NULL,
	"kind" "community_check_kind" NOT NULL,
	"on_quiet" "community_check_on_quiet" NOT NULL,
	"window_hours" integer NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_as" "community_check_ended_as",
	"ended_by_id" uuid,
	"ended_note" text,
	"asked_application" boolean DEFAULT false NOT NULL,
	"asked_interview" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_check_concern" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"raised_by_id" uuid NOT NULL,
	"note" text NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolution" "community_check_concern_resolution" DEFAULT 'standing' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"resolution_note" text
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
ALTER TABLE "community_check" ADD CONSTRAINT "community_check_arrival_id_admission_id_fk" FOREIGN KEY ("arrival_id") REFERENCES "public"."admission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check" ADD CONSTRAINT "community_check_ended_by_id_member_id_fk" FOREIGN KEY ("ended_by_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern" ADD CONSTRAINT "community_check_concern_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern" ADD CONSTRAINT "community_check_concern_check_id_community_check_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."community_check"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern" ADD CONSTRAINT "community_check_concern_raised_by_id_member_id_fk" FOREIGN KEY ("raised_by_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern" ADD CONSTRAINT "community_check_concern_resolved_by_id_member_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern_consent" ADD CONSTRAINT "community_check_concern_consent_concern_id_community_check_concern_id_fk" FOREIGN KEY ("concern_id") REFERENCES "public"."community_check_concern"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern_consent" ADD CONSTRAINT "community_check_concern_consent_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern_exclusion" ADD CONSTRAINT "community_check_concern_exclusion_concern_id_community_check_concern_id_fk" FOREIGN KEY ("concern_id") REFERENCES "public"."community_check_concern"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern_exclusion" ADD CONSTRAINT "community_check_concern_exclusion_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_concern_exclusion" ADD CONSTRAINT "community_check_concern_exclusion_added_by_id_member_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_overrule_support" ADD CONSTRAINT "community_check_overrule_support_concern_id_community_check_concern_id_fk" FOREIGN KEY ("concern_id") REFERENCES "public"."community_check_concern"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_check_overrule_support" ADD CONSTRAINT "community_check_overrule_support_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_check_one_open_per_arrival" ON "community_check" USING btree ("arrival_id") WHERE "community_check"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "community_check_community_open_idx" ON "community_check" USING btree ("community_id","ended_at");--> statement-breakpoint
CREATE INDEX "community_check_concern_check_idx" ON "community_check_concern" USING btree ("check_id");--> statement-breakpoint
CREATE INDEX "community_check_concern_raised_by_idx" ON "community_check_concern" USING btree ("raised_by_id");--> statement-breakpoint
CREATE INDEX "community_check_concern_community_resolution_idx" ON "community_check_concern" USING btree ("community_id","resolution");--> statement-breakpoint
CREATE INDEX "community_check_concern_consent_concern_idx" ON "community_check_concern_consent" USING btree ("concern_id");--> statement-breakpoint
CREATE INDEX "community_check_concern_exclusion_concern_idx" ON "community_check_concern_exclusion" USING btree ("concern_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_check_overrule_support_concern_member_unique" ON "community_check_overrule_support" USING btree ("concern_id","member_id");
-- Carry over everything the two old mechanisms hold, so no window and no concern is lost.
-- An invite's consensus window becomes an entry check; a decision's wider discussion becomes
-- an evaluation check; every objection becomes a concern with the same id, which is what lets
-- the shield rows below copy across by id alone.
--> statement-breakpoint
INSERT INTO "community_check" ("community_id", "arrival_id", "kind", "on_quiet", "window_hours", "opened_at", "deadline", "ended_at", "ended_as")
SELECT s.community_id, s.arrival_id, 'entry', 'continue', s.hours, s.opened, s.deadline,
  CASE WHEN s.is_open THEN NULL ELSE COALESCE(s.admitted_at, s.declined_at, s.withdrawn_at, now()) END,
  (CASE
    WHEN s.is_open THEN NULL
    WHEN s.admitted_member_id IS NOT NULL THEN CASE WHEN s.n_overruled > 0 THEN 'overruled' WHEN s.n_cleared > 0 THEN 'cleared' ELSE 'quiet' END
    WHEN s.declined_at IS NOT NULL THEN CASE WHEN s.n_upheld > 0 THEN 'upheld' ELSE 'closed' END
    ELSE 'closed'
  END)::"community_check_ended_as"
FROM (
  SELECT a.community_id, a.id AS arrival_id, c.recruitment_wider_discussion_hours AS hours,
    COALESCE(i.consent_at, a.created_at) AS opened,
    COALESCE(i.consensus_deadline, COALESCE(i.consent_at, a.created_at) + make_interval(hours => c.recruitment_wider_discussion_hours)) AS deadline,
    (i.consensus_state = 'announced' AND a.admitted_member_id IS NULL AND a.declined_at IS NULL AND a.withdrawn_at IS NULL) AS is_open,
    a.admitted_at, a.admitted_member_id, a.declined_at, a.withdrawn_at,
    (SELECT count(*) FROM "objection" o WHERE o.invite_id = i.id AND o.resolution = 'overruled') AS n_overruled,
    (SELECT count(*) FROM "objection" o WHERE o.invite_id = i.id AND o.resolution IN ('cleared', 'withdrawn')) AS n_cleared,
    (SELECT count(*) FROM "objection" o WHERE o.invite_id = i.id AND o.resolution = 'upheld') AS n_upheld
  FROM "community_invite" i
  JOIN "admission" a ON a.invite_id = i.id
  JOIN "community" c ON c.id = a.community_id
  WHERE i.consensus_state IN ('announced', 'admitted', 'withheld')
) s;
--> statement-breakpoint
INSERT INTO "community_check" ("community_id", "arrival_id", "kind", "on_quiet", "window_hours", "opened_at", "deadline", "ended_at", "ended_as")
SELECT s.community_id, s.arrival_id, 'evaluation',
  (CASE WHEN s.default_resolution = 'proceed' THEN 'admit' ELSE 'decline' END)::"community_check_on_quiet",
  s.hours, s.opened, s.deadline,
  CASE WHEN s.is_open THEN NULL ELSE COALESCE(s.deadline, now()) END,
  (CASE
    WHEN s.is_open THEN NULL
    WHEN s.resolution = 'accepted' THEN CASE WHEN s.n_overruled > 0 THEN 'overruled' WHEN s.n_cleared > 0 THEN 'cleared' ELSE 'quiet' END
    WHEN s.resolution = 'declined' THEN CASE WHEN s.n_upheld > 0 THEN 'upheld' ELSE 'quiet' END
    ELSE 'closed'
  END)::"community_check_ended_as"
FROM (
  SELECT a.community_id, a.id AS arrival_id, d.default_resolution, d.resolution,
    c.recruitment_wider_discussion_hours AS hours, d.decided_at AS opened,
    COALESCE(d.wider_discussion_deadline, d.decided_at + make_interval(hours => c.recruitment_wider_discussion_hours)) AS deadline,
    (d.resolution IS NULL AND a.admitted_member_id IS NULL AND a.declined_at IS NULL AND a.withdrawn_at IS NULL) AS is_open,
    (SELECT count(*) FROM "objection" o WHERE o.form_response_id = d.form_response_id AND o.resolution = 'overruled') AS n_overruled,
    (SELECT count(*) FROM "objection" o WHERE o.form_response_id = d.form_response_id AND o.resolution IN ('cleared', 'withdrawn')) AS n_cleared,
    (SELECT count(*) FROM "objection" o WHERE o.form_response_id = d.form_response_id AND o.resolution = 'upheld') AS n_upheld
  FROM "recruitment_decision" d
  JOIN "admission" a ON a.form_response_id = d.form_response_id
  JOIN "community" c ON c.id = a.community_id
  WHERE d.rule_outcome = 'wider_discussion'
) s
-- One window open at a time: an arrival already waiting on its entry check keeps that one.
WHERE NOT (s.is_open AND EXISTS (SELECT 1 FROM "community_check" k WHERE k.arrival_id = s.arrival_id AND k.ended_at IS NULL));
--> statement-breakpoint
INSERT INTO "community_check_concern" ("id", "community_id", "check_id", "raised_by_id", "note", "raised_at", "resolution", "resolved_at", "resolved_by_id", "resolution_note")
SELECT o.id, o.community_id, k.id, o.raised_by, o.note, o.raised_at, o.resolution::text::"community_check_concern_resolution", o.resolved_at, o.resolved_by_id, o.resolution_note
FROM "objection" o
JOIN LATERAL (
  SELECT k2.id FROM "community_check" k2 JOIN "admission" a ON a.id = k2.arrival_id
  WHERE (o.invite_id IS NOT NULL AND a.invite_id = o.invite_id AND k2.kind = 'entry')
     OR (o.form_response_id IS NOT NULL AND a.form_response_id = o.form_response_id AND k2.kind = 'evaluation')
  ORDER BY k2.opened_at DESC LIMIT 1
) k ON true;
--> statement-breakpoint
-- A concern that is still standing must never be dropped silently. If one has no arrival to hang
-- its window on (an application that predates arrivals and was never opened since), stop here
-- rather than lose it; settled history of that kind is the only thing that may be left behind.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "objection" o
    WHERE o.resolution = 'standing'
      AND NOT EXISTS (SELECT 1 FROM "community_check_concern" c WHERE c.id = o.id)
  ) THEN
    RAISE EXCEPTION 'A standing concern has no arrival to belong to. Settle it in the mediation queue first (or ask a developer to give its application an arrival), then run this migration again.';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO "community_check_concern_exclusion" ("id", "concern_id", "member_id", "added_by_id", "added_at")
SELECT e.id, e.objection_id, e.member_id, e.added_by, e.added_at FROM "objection_party_exclusion" e
WHERE EXISTS (SELECT 1 FROM "community_check_concern" c WHERE c.id = e.objection_id);
--> statement-breakpoint
INSERT INTO "community_check_concern_consent" ("id", "concern_id", "member_id", "granted_at", "withdrawn_at", "note")
SELECT e.id, e.objection_id, e.member_id, e.granted_at, e.withdrawn_at, e.note FROM "objection_party_consent" e
WHERE EXISTS (SELECT 1 FROM "community_check_concern" c WHERE c.id = e.objection_id);
--> statement-breakpoint
INSERT INTO "community_check_overrule_support" ("id", "concern_id", "member_id", "note", "supported_at")
SELECT e.id, e.objection_id, e.member_id, e.note, e.supported_at FROM "objection_overrule_support" e
WHERE EXISTS (SELECT 1 FROM "community_check_concern" c WHERE c.id = e.objection_id);
