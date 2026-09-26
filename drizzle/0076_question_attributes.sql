-- Two new profile-question attributes, and the member's section-level
-- consent that replaces per-question consent.
--
-- `sensitive` requires an access rule to exist and enables the member's
-- share-with-the-audience checkbox. The meaningful part isn't the label,
-- it's the default: a non-sensitive, unrestricted question is readable by
-- the whole community, so under-labelling a health question doesn't save
-- an Admin any work -- it publishes the data to everyone, visibly.
--
-- `emergency_access` means answering the question consents to emergency
-- reads. No separate tick, and the only way to refuse is not to answer --
-- the same deal a filled-in contact method offers. Meaningless on a
-- question everyone can already read, which is every non-sensitive
-- unrestricted one.
--
-- `consents_to_community_indicators` defaults TRUE, deliberately the
-- opposite of contribution_visible: a contribution record is generated
-- passively from task history so sharing it must be asked for, while an
-- indicator aggregates answers the member gave knowing the section may
-- appear. Answering is consenting, here and for emergency access alike.
--
-- Split from 0077 because drizzle's create-vs-rename prompt makes a
-- same-run drop+add ambiguous; two mechanical migrations are not.
--
ALTER TABLE "member" ADD COLUMN "consents_to_community_indicators" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_question" ADD COLUMN "sensitive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_question" ADD COLUMN "emergency_access" boolean DEFAULT false NOT NULL;