import { communityInviteStatus, getCommunityInviteByToken } from "@/lib/recruitment";
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

  return (
    <main className="mx-auto max-w-[480px] px-6 py-16">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Join</h1>

      {status !== "valid" ? (
        <div className="mt-4">
          <Banner tone="danger">{STATUS_MESSAGE[status]}</Banner>
        </div>
      ) : (
        <>
          <p className="mt-2 text-[13px] text-[var(--text-muted)]">
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
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Join
            </button>
          </form>
        </>
      )}
    </main>
  );
}
