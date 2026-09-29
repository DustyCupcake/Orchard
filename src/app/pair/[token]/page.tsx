import Link from "next/link";
import { getCurrentMember } from "@/lib/session";
import { getPairingByToken } from "@/lib/recruitment/pairs";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/kit";
import { answerPairingAction } from "./actions";

export const dynamic = "force-dynamic";

// §2.8's accept-the-pairing link, and the "same token shape" claim made
// real: this URL is the one the namer gets, and it is the *only* thing
// that turns a recorded pair into a confirmed one. The other end of the
// same token (logged out) is the application, pre-paired — which is why
// there is no separate URL for either half.
export default async function PairPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; answered?: string }>;
}) {
  const { token } = await params;
  const { error, answered } = await searchParams;
  const viewer = await getCurrentMember();
  const found = await getPairingByToken(token);

  if (!found) {
    return (
      <main className="mx-auto max-w-[560px] px-6 py-16">
        <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">
          This link isn&rsquo;t valid
        </h1>
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Ask whoever sent it for a fresh one — the person you named should still have it.
        </p>
      </main>
    );
  }

  const isNamer = viewer?.id === found.pair.requestedById;

  // Anyone else holding this link is a member who followed it from
  // somewhere. There is nothing for them to do — the pair is between two
  // applicants and the person who named them.
  if (viewer && !isNamer) {
    return (
      <main className="mx-auto max-w-[560px] px-6 py-16">
        <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">Not your link</h1>
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          This one is for {found.namerName}, who named somebody as the person they&rsquo;re coming
          with. There&rsquo;s nothing to do here.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[560px] px-6 py-16">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">
        {isNamer ? "Is this who you meant?" : "You're applying with someone"}
      </h1>

      {!isNamer && (
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          {found.namerName} said you&rsquo;re coming to {found.communityName} together. Carry on
          with your application below — nothing about it changes because of this.
        </p>
      )}

      {isNamer && found.pair.secondResponseId && (
        <>
          <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
            The person who used your link has sent an application. If it&rsquo;s the person you had
            in mind, say so — and if it isn&rsquo;t, they&rsquo;re still welcome on their own
            account, this just isn&rsquo;t the pairing.
          </p>
          <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">
            Confirming this does one thing: you can both be offered a single interview together
            instead of two. Nobody decides anything else from it, and either of you can decline that
            later.
          </p>
        </>
      )}

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      {answered && (
        <div className="mt-4">
          <Banner tone="success">Thanks — that&rsquo;s settled.</Banner>
        </div>
      )}

      {isNamer ? (
        found.pair.status === "accepted" ? (
          <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
            You&rsquo;ve already confirmed this pairing.
          </p>
        ) : found.pair.status === "declined" ? (
          <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
            You turned this pairing down. They&rsquo;re still applying on their own account — nothing
            about that has changed.
          </p>
        ) : found.pair.secondResponseId ? (
          <form action={answerPairingAction} className="mt-6 flex flex-wrap gap-2">
            <input type="hidden" name="token" value={token} />
            <button type="submit" name="accept" value="1" className={BUTTON_PRIMARY}>
              Yes, that&rsquo;s them
            </button>
            <button type="submit" name="accept" value="0" className={BUTTON_SECONDARY}>
              No, that&rsquo;s someone else
            </button>
          </form>
        ) : (
          <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
            Nobody&rsquo;s used this link yet. There&rsquo;s nothing to confirm — you&rsquo;ll get a
            link of your own to send if you want to.
          </p>
        )
      ) : (
        <a href={`/apply?pair=${encodeURIComponent(token)}`} className={`${BUTTON_PRIMARY} mt-6 inline-flex`}>
          Go to the application
        </a>
      )}

      <p className="mt-8 text-[length:var(--text-meta)] text-[var(--text-muted)]">
        <Link href="/" className="underline">
          Back to the start
        </Link>
      </p>
    </main>
  );
}
