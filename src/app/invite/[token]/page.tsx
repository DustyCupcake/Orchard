import {
  communityInviteStatus,
  consensusDisclosure,
  consensusWindowFor,
  getCommunityInviteByToken,
  getCommunityInviteRedemptionPath,
} from "@/lib/recruitment";
import { redirect } from "next/navigation";
import { firstLoginDestinationFor } from "@/lib/first-login";
import { Banner, BUTTON_PRIMARY, INPUT, LABEL } from "@/components/ui/kit";
import { redeemInviteAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_MESSAGE: Record<string, string> = {
  not_found: "This invite link isn't valid.",
  redeemed: "This invite link has already been used.",
  revoked: "This invite link has been revoked.",
  expired: "This invite link has expired.",
};

// Public, no login required. Deliberately shows nothing about the
// inviting member or the community's roster — see docs/spec.md's
// Recruitment: "Invite links." Redeeming skips the ordinary magic-link
// round-trip entirely: a valid, unexpired, unredeemed, unrevoked token
// is itself the proof of legitimacy.
//
// docs/plans/archive/joining-admission-plan.md §2 splits this page four ways, one per
// lane path, and the branch is made here rather than inside the lib so
// each shape can say something different about what is about to happen
// to this person:
//   process    → straight to /apply, with the token as the vouch;
//   nomination → the support link, which is where the window lives
//                (§2.4) and which carries its own way past it (§2.5);
//   check      → here, with the §2.6 disclosure and the binding consent
//                the plan's J10 requires before the arrival can be
//                announced at all;
//   direct     → here, as it has always been.
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; announced?: string }>;
}) {
  const { token } = await params;
  const { error, announced } = await searchParams;

  const invite = await getCommunityInviteByToken(token);
  const status = communityInviteStatus(invite);
  const path = invite && status === "valid" ? await getCommunityInviteRedemptionPath(invite) : null;

  if (invite && path) {
    if (path === "process") {
      redirect(`/apply?invite=${encodeURIComponent(token)}`);
    }
    if (path === "nomination") {
      // A nomination that has already been satisfied (supported, or the
      // invitee skipped it) is no longer a support question — fall
      // through to whatever the lane's process is, which for a
      // process-less nomination lane is the join form below.
      const { getNominationForInvite } = await import("@/lib/recruitment");
      const nomination = await getNominationForInvite(invite.id);
      if (nomination && nomination.state === "awaiting") {
        redirect(`/support/${nomination.supportToken}`);
      }
    }
  }

  const isConsensus = path === "check";
  const { communityName, windowHours } = invite
    ? await consensusWindowFor(invite.communityId)
    : { communityName: "this community", windowHours: 48 };
  const disclosure = consensusDisclosure(communityName, windowHours);

  if (announced && invite?.consensusState === "announced") {
    // One hop further than the direct path, not a different flow: the
    // consent invitee reads what was decided about their arrival *before*
    // being asked to fill in a profile, and this button is the only place
    // that ordering can be expressed. /welcome bounces anyone who has
    // already been through it straight back to the Dashboard, so a
    // returning member following a stale link lands where they'd expect.
    const onward = await firstLoginDestinationFor(invite.redeemedByMemberId ?? "");
    return (
      <main className="mx-auto max-w-[560px] px-6 py-16">
        <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">You&rsquo;re in — with one thing still open</h1>
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Your account is created and you&rsquo;re a member of {communityName}. Because this invite goes
          through a community check, your arrival has been announced and any member has{" "}
          {windowHours} hours to raise a concern.
        </p>
        <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">
          If nobody does, your place is settled automatically. If someone does, it doesn&rsquo;t get
          dropped on a timer — the mediation team talks it through with everyone involved, and
          unless they agree the concern is resolved, you&rsquo;re held rather than quietly let in or
          quietly pushed out. Nobody is told who raised it.
        </p>
        <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">
          You can ask us to stop at any time, without giving a reason.
        </p>
        <a href={onward} className={`${BUTTON_PRIMARY} mt-6 inline-flex`}>
          {onward === "/welcome" ? "Set up your profile" : "Go to the dashboard"}
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[520px] px-6 py-16">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">Join</h1>

      {status !== "valid" ? (
        <div className="mt-4">
          <Banner tone="danger">{STATUS_MESSAGE[status]}</Banner>
        </div>
      ) : (
        <>
          <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
            You&rsquo;ve been invited to join. Enter your email to create your account.
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

            {isConsensus && (
              // J10's second consent step, in the only place it can
              // honestly live: the invitee's own checkbox, next to the
              // text they agreed to, before anything is created. The
              // hidden `disclosure` field is what gets stored, so the
              // record keeps the exact words rather than a version of
              // them.
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
              {isConsensus ? "Join, with my arrival announced" : "Join"}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
