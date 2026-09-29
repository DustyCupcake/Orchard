import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getSupportView, nominationIsWaiting } from "@/lib/recruitment/support";
import { describeLaneConsequence, JOINING_LANE_COPY } from "@/lib/recruitment/lanes";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/kit";
import { recordSupportAction, skipNominationAction } from "./actions";

export const dynamic = "force-dynamic";

// §2.4's "one link, auth-branched" — the whole point of the link is that
// the same URL has to be right for both a member who was asked to vouch
// and a stranger holding a forwarded copy, so this page reads the session
// and branches on it rather than showing both and asking which they are.
//
// The branching is on *who you are*, not on what you came to do, because
// a logged-out visitor has only one possible next step (the application)
// while a member has two (vouch, or don't). The third branch — a member
// who arrives having already supported — gets the state and the thanks
// rather than a second copy of the same form.
export default async function SupportPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; supported?: string }>;
}) {
  const { token } = await params;
  const { error, supported } = await searchParams;
  const viewer = await getCurrentMember();
  const view = await getSupportView(token, viewer);

  if (!view) {
    return (
      <main className="mx-auto max-w-[560px] px-6 py-16">
        <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">This link isn&rsquo;t valid</h1>
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Support links are tied to one person&rsquo;s arrival. Ask whoever sent it to you for a fresh
          one — they can always make another.
        </p>
      </main>
    );
  }

  const waiting = nominationIsWaiting(view.state);
  const laneCopy = JOINING_LANE_COPY[view.lane];
  const deadline = view.deadline
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(view.deadline)
    : null;

  // A logged-out visitor is routed to the application, pre-tagged with the
  // token so the pair link is recorded (§2.4). That is the whole of the
  // anonymous branch: there is nothing to ask them here, because "do you
  // know this person" is a question only a member can answer.
  if (!viewer) {
    if (!waiting) {
      redirect(`/apply?invite=${encodeURIComponent(token)}`);
    }
    return (
      <main className="mx-auto max-w-[560px] px-6 py-16">
        <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">
          Someone&rsquo;s waiting on a second
        </h1>
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          The link you followed asked other members of the community whether they know this person.
          You&rsquo;re not signed in, so there&rsquo;s nothing for you to say here — and you shouldn&rsquo;t
          have to.
        </p>
        <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">
          If you&rsquo;re the person it&rsquo;s for, you can carry on with the application below and
          come back to this later — nobody is held up by it.
        </p>
        {deadline && (
          <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">
            The wait ends on its own on {deadline}, and they carry on either way.
          </p>
        )}
        <a href={`/apply?invite=${encodeURIComponent(token)}`} className={`${BUTTON_PRIMARY} mt-6 inline-flex`}>
          Go to the application
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[560px] px-6 py-16">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">
        {view.supportedByMe ? "You&rsquo;ve already backed this up" : "Can you vouch for someone?"}
      </h1>
      <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
        {view.supportedByMe
          ? "Thanks — that's on the record, and they can see your name. You can change what you said about how you know them until the wait is over."
          : `${laneCopy.who} Somebody has asked you to say how you know them.`}
      </p>

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      {supported && (
        <div className="mt-4">
          <Banner tone="success">Thanks — that&rsquo;s on the record now.</Banner>
        </div>
      )}

      <div
        className="mt-5 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
        style={{ background: "var(--neutral-100)" }}
      >
        <p className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">What they&rsquo;re in for</p>
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">{describeLaneConsequence(view.rule)}</p>
      </div>

      {!waiting ? (
        <div className="mt-6">
          <Banner tone="success">
            This one&rsquo;s already settled — nothing&rsquo;s waiting on anybody. If you were asked to
            vouch and you still want to say how you know them, that&rsquo;s not needed any more.
          </Banner>
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-col gap-2">
            <p className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">How do you know them?</p>
            {view.supports.length > 0 && (
              <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
                {view.supports.length >= view.supportCount
                  ? "That's enough — they're unblocked."
                  : `${view.supports.length} of ${view.supportCount} so far: ${view.supports.map((s) => s.name).join(", ")}.`}
              </p>
            )}
          </div>

          <form action={recordSupportAction} className="mt-4 flex flex-col gap-2">
            <input type="hidden" name="token" value={token} />
            <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
              <input type="checkbox" name="knowsPersonally" defaultChecked={view.supportedByMe?.knowsPersonally} className="mt-0.5" />
              <span>
                I know this person personally
                <span className="block text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  The strongest thing you can say, and the only one some lanes ask for.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
              <input type="checkbox" name="thinksGoodFit" defaultChecked={view.supportedByMe?.thinksGoodFit} className="mt-0.5" />
              <span>
                I don&rsquo;t know them, but I&rsquo;d expect them to fit
                <span className="block text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  A judgement about the fit rather than a relationship. Perfectly good — just a
                  different kind of proof.
                </span>
              </span>
            </label>
            <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
              At least one of these has to be ticked: a click with nothing behind it isn&rsquo;t
              anything they can count.
            </p>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              {view.supportedByMe ? "Update what I said" : "Back them up"}
            </button>
          </form>

          {deadline && (
            <p className="mt-4 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              If nobody gets to it by {deadline}, nothing happens to them — the wait just ends and
              they carry on. This is not a chance to refuse someone.
            </p>
          )}
        </>
      )}

      {view.applyInsteadAvailable && waiting && view.subjectKind === "invite" && (
        <details className="mt-8 border-t border-dashed border-[var(--border)] pt-4">
          <summary className="cursor-pointer text-[length:var(--text-body)] font-medium text-[var(--text-muted)]">
            I&rsquo;m the person this is about
          </summary>
          <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
            You can skip the wait and carry on. Nobody has to support you for that to work, and it
            doesn&rsquo;t count against you — the wait ending on its own does the same thing. You&rsquo;ll
            go wherever your invite&rsquo;s own rules send you: the application, or straight in.
          </p>
          <form action={skipNominationAction} className="mt-3">
            <input type="hidden" name="token" value={token} />
            <button type="submit" className={BUTTON_SECONDARY}>
              Skip the wait &mdash; carry on
            </button>
          </form>
        </details>
      )}
    </main>
  );
}
