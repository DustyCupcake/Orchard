import { boolean, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";

// docs/plans/admission-flow.md §6a — when a community's sign-in is its own identity
// provider, "admitted" has to mean something there too.

// The state of making a newly admitted member able to sign in at the provider. A
// row exists only for a member admission tried to set up; `pending` is "not yet" (the
// provider was unreachable, or the person was just admitted), `done` is "they have an
// account and the role", and `failed` is "an administrator needs to look" — the
// provider refused with something a retry will not fix. Admission itself never waits on
// any of it: the person is admitted either way, and this is what the arrival's page and
// the administrators' to-do read.
export const signInSetupStatusEnum = pgEnum("sign_in_setup_status", ["pending", "done", "failed"]);

export const signInSetup = pgTable(
  "sign_in_setup",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => community.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    status: signInSetupStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    // What the provider said last time, for the administrator who has to act on it.
    // Never a token or a code.
    lastError: text("last_error"),
    // The provider's own id for the person, which is the OIDC `sub`.
    providerUserId: text("provider_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sign_in_setup_member_unique").on(t.memberId)],
);

export const unmatchedSignInResolutionEnum = pgEnum("unmatched_sign_in_resolution", ["linked", "turned_away"]);

// A sign-in that carries the role but that Orchard will not turn into a member by
// itself: nobody admitted here has the address, or a member does but nothing proves
// the person at the provider is them, or the community only lets admitted people in.
// It is held for an administrator to link to a member or turn away, instead of
// silently creating an account — which is what made a second, empty member for people
// who already had one. Keyed on the provider's `sub`, so a person who tries again is the
// same row, not a growing list.
export const unmatchedSignIn = pgTable(
  "unmatched_sign_in",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => community.id),
    providerSubject: text("provider_subject").notNull(),
    loginEmail: text("login_email").notNull(),
    // The provider's own word on whether it checked the address; null = it said nothing.
    emailVerified: boolean("email_verified"),
    nickname: text("nickname"),
    givenName: text("given_name"),
    // A member that already has this address and no provider account of their own,
    // offered to the administrator as the one-click answer. A suggestion, never a link.
    suggestedMemberId: uuid("suggested_member_id").references(() => member.id),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    resolution: unmatchedSignInResolutionEnum("resolution"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => member.id),
    linkedMemberId: uuid("linked_member_id").references(() => member.id),
  },
  (t) => [uniqueIndex("unmatched_sign_in_subject_unique").on(t.providerSubject)],
);
