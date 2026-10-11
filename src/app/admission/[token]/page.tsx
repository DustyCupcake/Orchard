import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, signInSetup } from "@/db/schema";
import { getArrivalByToken, getAskedApplicationForm, getInterviewAvailability, getInterviewPoll, listSupports, loadArrivalReadout, supportLink, syncInterviewFacts } from "@/lib/recruitment";
import type { FormField } from "@/lib/forms";
import FieldPreview, { toPreviewShape } from "@/components/FieldPreview";
import AvailabilityGrid from "@/app/(app)/scheduling-polls/AvailabilityGrid";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/kit";
import { answerPairingAction, makeApplyTogetherLinkAction, sendAskedApplicationAction, sendSignInLinkAction, withdrawAction } from "./actions";
import { listPairingsForArrival } from "@/lib/recruitment/pairs";
import { publicAppUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

// The link is the person's only credential until they are a member, so
// nothing about it should be indexed or leaked to another site through a
// referrer.
export const metadata = {
  title: "Your request to join",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

// docs/admission-flow.md §4: "where they are, in plain words, and what
// happens next" — the one place a person in the process can see that. It has
// no login, because they have no account yet; the link they were given is the
// proof. It says nothing the person didn't give us or isn't owed: their own
// stage, and the steps their lane asks for. Never who has said what about
// them, and never who raised a concern.
export default async function AdmissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ sent?: string; withdrawn?: string; error?: string; applied?: string; paired?: string }>;
}) {
  const { token } = await params;
  const { sent, withdrawn, error, applied, paired } = await searchParams;

  const found = await getArrivalByToken(token);
  if (!found) notFound();
  // What the interview poll says is written onto the arrival before it is read, so
  // the stage and this page agree about whether the call has been booked or held.
  const arrival = found.interviewPollId ? await syncInterviewFacts(found.id) : found;

  const [communityRow] = await db.select({ name: community.name }).from(community).where(eq(community.id, arrival.communityId));
  // An application they were asked for and haven't sent: their own next move, so the
  // holders aren't chasing it (and the sentence below says what it is).
  const stillOpen = !arrival.admittedMemberId && !arrival.declinedAt && !arrival.withdrawnAt;
  const needsApplication = stillOpen && arrival.requiredApplication && !arrival.applicationSubmittedAt;
  const { readout, sentence, laneName } = await loadArrivalReadout(arrival, { waitingOnThePerson: needsApplication });
  const askedForm = needsApplication ? await getAskedApplicationForm(arrival) : null;
  const askedFields = (askedForm?.fields as FormField[] | undefined) ?? [];

  const steps = [
    arrival.requiredVerification === "community_check" && "Your arrival is announced to the community, and anyone can raise a concern",
    arrival.requiredApplication && "An application",
    arrival.requiredInterview && "An interview",
    arrival.requiredEvaluation && "A decision, from the people who read your application or met you",
  ].filter(Boolean) as string[];

  const interviewPoll = await getInterviewPoll(arrival);
  const myAvailability = interviewPoll ? await getInterviewAvailability(arrival) : [];
  const interviewOpen = arrival.requiredInterview && !arrival.admittedMemberId && !arrival.declinedAt && !arrival.withdrawnAt;
  const supports = await listSupports(arrival.id);
  // Shown while there is something to vouch for: a lane with an application or an
  // interview. (A community check has its own way for the community to speak.)
  const canBeVouchedFor = arrival.requiredEvaluation && !arrival.admittedMemberId && !arrival.declinedAt && !arrival.withdrawnAt;

  // Admitted, but their account at the community's sign-in provider isn't ready yet
  // (docs/admission-flow.md §6a): the admission stands, and the person is told what is left.
  const [setup] = arrival.admittedMemberId
    ? await db.select({ status: signInSetup.status }).from(signInSetup).where(eq(signInSetup.memberId, arrival.admittedMemberId))
    : [];
  const signInPending = Boolean(setup && setup.status !== "done");

  // Who they are applying with (§2, pairing): the link to send, and — if somebody used it, or the
  // team linked them — the question of whether that is who they meant.
  const pairings = await listPairingsForArrival(arrival, (t) => `${publicAppUrl()}/pair/${t}`);
  const canPair = stillOpen && (arrival.requiredApplication || arrival.requiredInterview);

  const finished = readout.stage === "admitted" || readout.stage === "declined" || readout.stage === "withdrawn";

  return (
    <main className="mx-auto max-w-[560px] px-6 py-16">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">
        Your request to join {communityRow?.name ?? "the community"}
      </h1>
      <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
        For {arrival.name}. This page is private to you — please don&rsquo;t share the link.
      </p>

      {sent && (
        <div className="mt-4">
          <Banner tone="success">If that address is a member, a sign-in link is on its way.</Banner>
        </div>
      )}
      {withdrawn && (
        <div className="mt-4">
          <Banner tone="success">You&rsquo;ve stopped this request. Nothing more will happen.</Banner>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      {applied && (
        <div className="mt-4">
          <Banner tone="success">Thank you — your application is in.</Banner>
        </div>
      )}

      <p className="mt-6 text-[length:var(--text-body)] text-[var(--text)]">{sentence}</p>

      {needsApplication && askedForm && (
        <section className="mt-8">
          <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">A little more about you</h2>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            {communityRow?.name ?? "The community"} would like an application from you before it goes any further. It is read by the
            people who look after joining, and nobody else.
          </p>
          {askedForm.description && (
            <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">{askedForm.description}</p>
          )}
          <form action={sendAskedApplicationAction} className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="token" value={token} />
            {askedFields.map((f) => (
              <FieldPreview
                key={f.key}
                field={toPreviewShape({ ...f, label: f.label, required: f.required ?? false })}
                name={`field_${f.key}`}
              />
            ))}
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Send my application
            </button>
          </form>
        </section>
      )}

      {readout.stage === "admitted" && signInPending && (
        <div className="mt-4">
          <Banner tone="warning">
            You&rsquo;re admitted, but your sign-in is still being set up — someone is sorting it out. You don&rsquo;t need to do anything yet.
          </Banner>
        </div>
      )}

      {readout.stage === "admitted" && (
        <form action={sendSignInLinkAction} className="mt-4">
          <input type="hidden" name="token" value={token} />
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Email me a sign-in link
          </button>
          <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
            It goes to {arrival.email}, and works once for 15 minutes.
          </p>
        </form>
      )}

      {interviewOpen && (
        <section className="mt-8">
          <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Your conversation</h2>
          {interviewPoll?.confirmedSlotStart && interviewPoll.confirmedSlotEnd ? (
            <div className="mt-2">
              <Banner tone="success">
                Booked for {new Date(interviewPoll.confirmedSlotStart).toLocaleString()} –{" "}
                {new Date(interviewPoll.confirmedSlotEnd).toLocaleTimeString()}
              </Banner>
            </div>
          ) : interviewPoll ? (
            <>
              <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                Paint the times you&rsquo;re free to talk — nobody sees anyone else&rsquo;s times until one is confirmed, and you can change
                yours until then. The more you offer, the sooner it can be booked.
              </p>
              <div className="mt-4">
                <AvailabilityGrid
                  pollId={token}
                  rangeStart={interviewPoll.rangeStart}
                  rangeEnd={interviewPoll.rangeEnd}
                  initialSelected={myAvailability}
                  readOnly={false}
                  submitUrl={`/api/admission/${token}/availability`}
                />
              </div>
            </>
          ) : (
            <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
              We&rsquo;ll ask you to choose times as soon as conversations are open — nothing for you to do until then.
            </p>
          )}
        </section>
      )}

      {canBeVouchedFor && (
        <section className="mt-8">
          <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Members who know you</h2>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            If you know people in {communityRow?.name ?? "the community"}, send them this link. It lets them say how they know you
            {arrival.supportShortcutCount
              ? ` — and when ${arrival.supportShortcutCount} member${arrival.supportShortcutCount === 1 ? " has" : "s have"} done that, the rest of the process is skipped and you're in.`
              : ", and the people reading your request will see it."}{" "}
            It&rsquo;s optional: if nobody does, nothing changes and you simply carry on.
          </p>
          <p className="mt-2 break-all text-[length:var(--text-body)] text-[var(--text)]">{supportLink(arrival.supportToken)}</p>
          <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
            This is a different link from this page&rsquo;s — it can only be used to vouch, never to see or change anything of yours.
          </p>
          <p className="mt-2 text-[length:var(--text-body)] text-[var(--text)]">
            {supports.length === 0
              ? "Nobody has vouched yet."
              : `Vouched for by ${supports.map((sp) => sp.name).join(", ")}.`}
          </p>
        </section>
      )}

      {(canPair || pairings.length > 0) && (
        <section className="mt-8">
          <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Applying with someone?</h2>
          {paired && (
            <div className="mt-2">
              <Banner tone="success">Thanks — that&rsquo;s settled.</Banner>
            </div>
          )}
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            If you&rsquo;re joining together, you can be offered a single interview between you. That&rsquo;s all it does: nothing about how
            either of you is assessed changes, and either of you can say no to the shared interview later.
          </p>
          {pairings.map((p) => (
            <div key={p.id} className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              {p.link ? (
                <>
                  <p className="text-[length:var(--text-body)] text-[var(--text)]">Send this link to the person you&rsquo;re applying with:</p>
                  <p className="mt-1 break-all text-[length:var(--text-body)] text-[var(--text)]">{p.link}</p>
                  <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">Nobody has used it yet.</p>
                </>
              ) : p.canAnswer ? (
                <>
                  <p className="text-[length:var(--text-body)] text-[var(--text)]">
                    {p.otherName ?? "Someone"} {p.otherName ? "is down as applying with you. Is that who you meant?" : "applied through your link. Is that who you meant?"}
                  </p>
                  <form action={answerPairingAction} className="mt-2 flex flex-wrap gap-2">
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="pairId" value={p.id} />
                    <button type="submit" name="accept" value="1" className={BUTTON_PRIMARY}>
                      Yes, that&rsquo;s them
                    </button>
                    <button type="submit" name="accept" value="0" className={BUTTON_SECONDARY}>
                      No, that&rsquo;s someone else
                    </button>
                  </form>
                </>
              ) : (
                <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
                  {p.status === "accepted"
                    ? `You're applying with ${p.otherName ?? "someone"}.`
                    : p.status === "declined"
                      ? "That pairing was turned down. You're each still applying on your own account — nothing about that changes."
                      : `Waiting for ${p.otherName ?? "them"} to be confirmed.`}
                </p>
              )}
            </div>
          ))}
          {canPair && !pairings.some((p) => p.link) && (
            <form action={makeApplyTogetherLinkAction} className="mt-3">
              <input type="hidden" name="token" value={token} />
              <button type="submit" className={`${BUTTON_SECONDARY} w-fit`}>
                Make a link for the person I&rsquo;m applying with
              </button>
            </form>
          )}
        </section>
      )}

      {steps.length > 0 && !finished && (
        <section className="mt-8">
          <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">
            What {laneName ? `“${laneName}”` : "this"} involves
          </h2>
          <ol className="mt-2 list-decimal pl-5 text-[length:var(--text-body)] text-[var(--text-muted)]">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      )}

      {!finished && (
        <form action={withdrawAction} className="mt-10 border-t border-[var(--border)] pt-4">
          <input type="hidden" name="token" value={token} />
          <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
            You can stop at any time, without giving a reason.
          </p>
          <button type="submit" className={`${BUTTON_SECONDARY} mt-2 w-fit`}>
            Stop this request
          </button>
        </form>
      )}
    </main>
  );
}
