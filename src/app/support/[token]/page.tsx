import Link from "next/link";
import { getCurrentMember } from "@/lib/session";
import { getSupportView } from "@/lib/recruitment";
import { Banner, BUTTON_PRIMARY } from "@/components/ui/kit";
import { supportAction } from "./actions";

export const dynamic = "force-dynamic";

// The link a person hands to members who know them (docs/admission-flow.md §2).
// It is a separate credential from the person's own page, and what it can do is
// deliberately small: a member who opens it can say how they know the person,
// once, and nothing else — it can never act for the person or show their page.
//
// The person's name is shown only to a signed-in member of the same community,
// because that is who needs it to answer honestly and nobody else is owed it.
// Nothing here is a deadline or a count that must be reached: a person with no
// support simply carries on with the process they are in.
export default async function SupportPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { token } = await params;
  const { error, done } = await searchParams;
  const viewer = await getCurrentMember();
  const view = await getSupportView(token, viewer);

  if (!view) {
    return (
      <main className="mx-auto max-w-[560px] px-6 py-16">
        <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">This link isn&rsquo;t valid</h1>
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Ask whoever sent it for a fresh one — the person it&rsquo;s about still has theirs.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[560px] px-6 py-16">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">
        {view.personName ? `Do you know ${view.personName}?` : `Someone has asked for your word`}
      </h1>
      <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
        {view.personName ? `${view.personName} has asked to join` : "Somebody has asked to join"} {view.communityName}, and thought you might
        know them. If you do — or you&rsquo;d expect them to fit — your word helps. If you don&rsquo;t, there&rsquo;s nothing to do: nothing happens to
        them either way, they just carry on with the process they&rsquo;re already in.
      </p>

      {done && (
        <div className="mt-4">
          <Banner tone="success">Thank you — your word is recorded.</Banner>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {view.supports.length > 0 && viewer && (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Already vouched for by {view.supports.map((s) => s.name).join(", ")}.
        </p>
      )}

      {!viewer ? (
        <p className="mt-6 text-[length:var(--text-body)] text-[var(--text)]">
          <Link href={`/login`} className="text-[var(--accent-1)] underline">
            Sign in
          </Link>{" "}
          as a member, then open this link again.
        </p>
      ) : view.cannotBecause ? (
        <p className="mt-6 text-[length:var(--text-body)] text-[var(--text-muted)]">{view.cannotBecause}</p>
      ) : (
        <form action={supportAction} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <p className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">How do you know them?</p>
          <label className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
            <input type="checkbox" name="knowsPersonally" defaultChecked={view.mine?.knowsPersonally} />
            I know them personally
          </label>
          <label className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
            <input type="checkbox" name="thinksGoodFit" defaultChecked={view.mine?.thinksGoodFit} />
            I don&rsquo;t know them, but I think they&rsquo;d fit
          </label>
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            {view.mine ? "Update my word" : "Add my word"}
          </button>
        </form>
      )}
    </main>
  );
}
