import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { community, communityInvite, objection, recruitmentApplicationConsent } from "@/db/schema";
import { seedCycleParticipation } from "../participation";

// Consensus, the third verification mode (docs/joining-admission-plan.md
// §2.2/§2.6/J10, work-plan step 5). The machinery already existed for
// the evaluated path's wider-discussion window; this module is the
// invite-shaped twin of it, kept deliberately thin so the two windows
// cannot drift:
//
//   consent    — the two steps J10 insists on. The inviter's awareness
//                tick at send (on community_invite) and the invitee's
//                own binding checkbox at redemption (recorded with the
//                exact text they read).
//   the window — recruitmentWiderDiscussionHours, reused as §2.2 says it
//                should be, opened when the arrival is announced.
//   the timer  — this module's whole authority. It can move a window
//                from announced to admitted, and it can do nothing
//                else at all: an objection is never dropped by a clock.

// The text the invitee reads before ticking the box. Generated from the
// community's own settings rather than written once and frozen, because
// the two numbers in it are the community's decisions and a disclosure
// that quoted the wrong window would be worse than none. The sentence
// "you can ask us to stop at any time" is not decoration: the binding
// consent is the *invitee's* lever in §2.6, and a checkbox that reads as
// bureaucratic consent is not a lever.
export function consensusDisclosure(communityName: string, windowHours: number): string {
  return [
    `When you join ${communityName}, your arrival is announced to the community.`,
    `For ${windowHours} hours after that, any member can raise a concern about your joining.`,
    "Your inviter has told you this is what happens — they confirmed that when they sent your invite — but this is your own agreement, not theirs.",
    "If someone raises a concern, it does not disappear: the community's mediation team talks it through with everyone involved, and unless they agree the concern is resolved, your joining is held.",
    "We will never share who raised a concern with you or with your inviter.",
    "You can ask us to stop at any time, and you do not have to give a reason.",
  ].join(" ");
}

// The single place a consensus arrival is admitted, so the "no objection
// by the deadline → auto-admitted" rule exists in one implementation
// whether the trigger is the scheduled job, a cleared objection, or an
// overruled one. Splitting it is exactly how the evaluated path ended up
// with a timer that could both admit and refuse.
export async function completeConsensusArrival(invite: typeof communityInvite.$inferSelect) {
  if (invite.consensusState !== "announced") {
    return null;
  }
  const [updated] = await db
    .update(communityInvite)
    .set({ consensusState: "admitted" })
    .where(and(eq(communityInvite.id, invite.id), eq(communityInvite.consensusState, "announced")))
    .returning();
  if (!updated) return null;
  // "Admission completes" is the arrival itself: the participation row
  // the roster and the capacity count are built from. It is seeded here
  // and nowhere earlier, which is what makes the consent gate real —
  // before this point the Member row exists (they had to be able to be
  // told what was happening to them) but their place in the event does
  // not.
  if (updated.cycleId && updated.redeemedByMemberId) {
    await seedCycleParticipation(db, updated.cycleId, updated.redeemedByMemberId);
  }
  return updated;
}

// The scheduled half of §2.6. Reads only the windows whose deadline has
// passed and that have no standing objection, and can therefore only
// ever admit. An objection makes the row skip the deadline entirely —
// not "resolve it in the object's favour", just "not this job's to
// decide" — which is the fix for the plan's named failure: the old
// evaluated path held an outcome pending on a human and, in a passive
// team, that meant the objection vetoed the arrival forever with nobody
// notified. Here the window's expiry is a *duty signal* instead (§5.4's
// queue), so inaction is visible rather than decisive.
export async function resolveConsensusWindows() {
  const due = await db
    .select()
    .from(communityInvite)
    .where(
      and(
        eq(communityInvite.consensusState, "announced"),
        lt(communityInvite.consensusDeadline, new Date()),
      ),
    );
  if (due.length === 0) {
    return { checked: 0, admitted: 0, heldForMediation: 0 };
  }
  const objectionRows = await db
    .select({ inviteId: objection.inviteId })
    .from(objection)
    .where(
      and(
        inArray(
          objection.inviteId,
          due.map((d) => d.id),
        ),
        eq(objection.resolution, "standing"),
      ),
    );
  const heldIds = new Set(objectionRows.map((o) => o.inviteId).filter((v): v is string => Boolean(v)));

  let admitted = 0;
  for (const invite of due) {
    if (heldIds.has(invite.id)) continue;
    if (await completeConsensusArrival(invite)) admitted++;
  }
  return { checked: due.length, admitted, heldForMediation: heldIds.size };
}

// The public-applicant half of J10. There is no redemption step for
// someone who applied on their own, so the disclosure and the checkbox
// happen at the application itself and the record lands here instead of
// on an invite row. The announcement (the window) is the existing
// decision's wider-discussion window — a public applicant on a consensus
// lane reaches the community-check stage through the same decision
// machinery as everybody else, which is the point of §2.6's "one
// discipline, applied to both".
export async function recordApplicationConsent(formResponseId: string, disclosure: string) {
  const [created] = await db
    .insert(recruitmentApplicationConsent)
    .values({ formResponseId, disclosure })
    .returning();
  return created;
}

export async function hasApplicationConsent(formResponseId: string): Promise<boolean> {
  const rows = await db
    .select({ id: recruitmentApplicationConsent.id })
    .from(recruitmentApplicationConsent)
    .where(eq(recruitmentApplicationConsent.formResponseId, formResponseId));
  return rows.length > 0;
}

// Reads the community's own settings for the number the disclosure
// quotes, so the caller (the /apply page, the invite form) never has to
// know which column the window lives in — and so the disclosure text
// and the window that is actually enforced can never come from two
// different places.
export async function consensusWindowFor(communityId: string): Promise<{ communityName: string; windowHours: number }> {
  const [communityRow] = await db
    .select({ name: community.name, hours: community.recruitmentWiderDiscussionHours })
    .from(community)
    .where(eq(community.id, communityId));
  return { communityName: communityRow?.name ?? "this community", windowHours: communityRow?.hours ?? 48 };
}
