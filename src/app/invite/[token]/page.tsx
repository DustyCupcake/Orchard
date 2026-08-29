import { communityInviteStatus, getCommunityInviteByToken } from "@/lib/recruitment";
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
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
      <h1>Join</h1>

      {status !== "valid" ? (
        <p style={{ color: "crimson" }}>{STATUS_MESSAGE[status]}</p>
      ) : (
        <>
          <p style={{ color: "#666" }}>
            You&rsquo;ve been invited to join. Enter your email to create your account.
          </p>
          {error && <p style={{ color: "crimson" }}>{error}</p>}
          <form
            action={redeemInviteAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 360 }}
          >
            <input type="hidden" name="token" value={token} />
            <label>
              Email
              <br />
              <input type="email" name="email" required style={{ padding: "0.4rem", width: "100%" }} />
            </label>
            <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
              Join
            </button>
          </form>
        </>
      )}
    </main>
  );
}
