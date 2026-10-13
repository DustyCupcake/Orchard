DROP TABLE "objection" CASCADE;--> statement-breakpoint
DROP TABLE "objection_overrule_support" CASCADE;--> statement-breakpoint
DROP TABLE "objection_party_consent" CASCADE;--> statement-breakpoint
DROP TABLE "objection_party_exclusion" CASCADE;--> statement-breakpoint
ALTER TABLE "community_invite" DROP COLUMN "consensus_state";--> statement-breakpoint
ALTER TABLE "community_invite" DROP COLUMN "consensus_deadline";--> statement-breakpoint
DROP TYPE "public"."invite_consensus_state";--> statement-breakpoint
DROP TYPE "public"."objection_resolution";