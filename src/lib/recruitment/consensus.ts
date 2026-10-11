import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, recruitmentApplicationConsent } from "@/db/schema";

// The consent half of the community check (docs/admission-flow.md §5, and J10 in
// docs/joining-admission-plan.md). The window itself — opening it, raising a
// concern in it, what happens when it ends — is community-check.ts and
// check-outcome.ts; what is left here is the text a person reads and agrees to
// before their arrival is announced, and the record that they did.
//
//   consent    — the two steps J10 insists on. The inviter's awareness tick at
//                send (on community_invite) and the invitee's own binding
//                checkbox at redemption (recorded with the exact text they read).
//   the window — recruitmentWiderDiscussionHours, opened as a community check once
//                consent is given.

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
    "If someone raises a concern, it does not disappear: the community's mediation team talks it through with everyone involved, and unless they agree the concern is resolved, your joining is held. They may also ask you for a little more — an application, or a conversation — before it goes on.",
    "We will never share who raised a concern with you or with your inviter.",
    "You can ask us to stop at any time, and you do not have to give a reason.",
  ].join(" ");
}

// The public-applicant half of J10. There is no redemption step for
// someone who applied on their own, so the disclosure and the checkbox
// happen at the application itself and the record lands here instead of
// on an invite row.
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
