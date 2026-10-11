import Link from "next/link";
import { getPairingByToken } from "@/lib/recruitment/pairs";
import { BUTTON_PRIMARY } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

// docs/admission-flow.md §2, "Pairing": the link somebody sends to the person they are
// applying with. All it does is carry them to the application, paired. The confirming half
// — "is this who you meant?" — is on the namer's own page (/admission/<token>), because the
// namer is a person in the funnel, not necessarily a member with a login.
export default async function PairPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await getPairingByToken(token);

  if (!found) {
    return (
      <main className="mx-auto max-w-[560px] px-6 py-16">
        <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">This link isn&rsquo;t valid</h1>
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Ask whoever sent it for a fresh one — they can make another from their own page.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[560px] px-6 py-16">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">
        {found.view === "apply" ? "You're applying with someone" : "This link has been used"}
      </h1>
      {found.view === "apply" ? (
        <>
          <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
            {found.namerName} said you&rsquo;re coming to {found.communityName} together. Carry on with your application — nothing
            about how it&rsquo;s assessed changes because of this. It only means the two of you can be offered one interview between
            you, if you both want that.
          </p>
          <a href={`/apply?pair=${encodeURIComponent(token)}`} className={`${BUTTON_PRIMARY} mt-6 inline-flex`}>
            Go to the application
          </a>
        </>
      ) : (
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Somebody has already applied through it. If that wasn&rsquo;t you, ask {found.namerName} for a fresh link.
        </p>
      )}
      <p className="mt-8 text-[length:var(--text-meta)] text-[var(--text-muted)]">
        <Link href="/" className="underline">
          Back to the start
        </Link>
      </p>
    </main>
  );
}
