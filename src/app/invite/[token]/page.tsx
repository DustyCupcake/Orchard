import {
  communityInviteStatus,
  consensusDisclosure,
  consensusWindowFor,
  getCommunityInviteByToken,
  getCommunityInviteLane,
} from "@/lib/recruitment";
import { redirect } from "next/navigation";
import { Banner, BUTTON_PRIMARY, INPUT, LABEL } from "@/components/ui/kit";
import { redeemInviteAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_MESSAGE: Record<string, string> = {
  not_found: "This invite link isn't valid.",
  redeemed: "This invite link has already been used.",
  revoked: "This invite link has been revoked.",
  expired: "This invite link has expired.",
};

// Public, no login required. Deliberately shows nothing about the inviting
// member or the community's roster — see docs/spec.md's Recruitment: "Invite
// links." Redeeming skips the ordinary magic-link round-trip entirely: a
// valid, unexpired, unredeemed, unrevoked token is itself the proof of
// standing.
//
// What the page does is decided by the lane the invite takes
// (docs/admission-flow.md §2a), looked up live from what the inviter
// declared:
//   asks for an application → straight to /apply, with the token as the vouch;
//   community check         → here, with the disclosure and the binding consent
//                             the plan requires before the arrival can be
//                             announced at all;
//   anything else           → here, asking only for an email.
// And if no lane open in the invite's context takes this kind of invite any
// more, the invite is held rather than revoked: the page says so, and the
// link works again if the lane does.
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const invite = await getCommunityInviteByToken(token);
  const status = communityInviteStatus(invite);
  const resolved = invite && status === "valid" ? await getCommunityInviteLane(invite) : null;

  if (invite && resolved?.lane.applicationRequired) {
    redirect(`/apply?invite=${encodeURIComponent(token)}`);
  }

  const held = Boolean(invite) && status === "valid" && !resolved;
  const isCheck = resolved?.route === "check";
  const { communityName, windowHours } = invite
    ? await consensusWindowFor(invite.communityId)
    : { communityName: "this community", windowHours: 48 };
  const disclosure = consensusDisclosure(communityName, windowHours);

  return (
    <main className="mx-auto max-w-[520px] px-6 py-16">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">Join</h1>

      {status !== "valid" ? (
        <div className="mt-4">
          <Banner tone="danger">{STATUS_MESSAGE[status]}</Banner>
        </div>
      ) : held ? (
        <div className="mt-4">
          <Banner tone="warning">
            This invitation can&rsquo;t be used right now &mdash; {communityName} isn&rsquo;t taking this kind of
            invitation at the moment. Your link is kept, so it&rsquo;s worth trying again later.
          </Banner>
        </div>
      ) : (
        <>
          <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
            You&rsquo;ve been invited to join. Enter your email to continue.
          </p>
          {error && (
            <div className="mt-4">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}
          <form action={redeemInviteAction} className="mt-6 flex max-w-[360px] flex-col gap-2">
            <input type="hidden" name="token" value={token} />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Email</span>
              <input type="email" name="email" required className={INPUT} />
            </label>

            {isCheck && (
              // The invitee's own binding consent, in the only place it can
              // honestly live: their own checkbox, next to the text they
              // agreed to, before anything is created. The hidden
              // `disclosure` field is what gets stored, so the record keeps
              // the exact words rather than a version of them.
              <div className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="disclosure" value={disclosure} />
                <div
                  className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-[length:var(--text-body)] text-[var(--text-muted)]"
                  style={{ background: "var(--neutral-100)" }}
                >
                  <p className="mb-1 text-[length:var(--text-meta)] font-medium text-[var(--text)]">
                    Before you join — please read this
                  </p>
                  {disclosure}
                </div>
                <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                  <input type="checkbox" name="consentAccepted" required className="mt-0.5" />
                  <span>
                    I&rsquo;ve read that and understood my arrival is announced to {communityName}, and
                    that someone may raise a concern about it.
                  </span>
                </label>
              </div>
            )}

            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              {isCheck ? "Continue, with my arrival announced" : "Continue"}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
