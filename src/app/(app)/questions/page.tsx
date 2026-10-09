import Link from "next/link";
import { getViewerClock } from "@/lib/view-clock";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { listOutstandingQuestions } from "@/lib/profile-questions";
import { toFieldShape } from "@/lib/field-shape";
import { listOpenCycles } from "@/lib/cycles";
import { listAudienceConsentsForAnswers, listAudiencesForQuestions, type Audience } from "@/lib/sensitive-data";
import ProfileQuestionForm from "@/components/ProfileQuestionForm";
import { Banner, CARD } from "@/components/ui/kit";
import { submitQuestionAnswerAction } from "./actions";

export const dynamic = "force-dynamic";

// Every question this member still owes an answer to, in one place.
//
// This is the destination the Dashboard's and Community's declare-joining
// controls send someone to when the event they just declared for has
// questions of its own — the "cycle onboarding" half of the two onboardings
// this app has (the other, one-time and community-wide, is the Dashboard's
// welcome panel from Phase 56). It also aggregates the standing once-ever
// questions, which is why it exists as a page rather than a per-event
// form: a community that marks a question `required` wants it chased
// whoever is in the room, not just whoever happens to arrive via one
// particular path.
//
// The `?cycle=` focus is what makes it an *event* form. listOutstanding-
// Questions resolves per_cycle/phase questions against that event instead
// of the member's own declared one (see its options.cycleId), so the
// declare flow and the answers land on the same event.
export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string; error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { cycle: cycleParam, error } = await searchParams;
  const requestedCycleId = cycleParam && cycleParam !== "active" ? cycleParam : null;

  // Resolved through the community's own open cycles rather than by
  // looking the id up directly, so a stale/foreign/closed ?cycle= simply
  // falls back to the member's declared event instead of erroring — this
  // is a link target, and links go stale.
  const openCycles = await listOpenCycles(viewing);
  const focus = requestedCycleId ? openCycles.find((c) => c.id === requestedCycleId) ?? null : null;
  const focusCycleId = focus?.id ?? null;

  const outstanding = await listOutstandingQuestions(viewing, { cycleId: focusCycleId });
  const onceEver = outstanding.filter((o) => o.question.scope === "once_ever");
  const perEvent = outstanding.filter((o) => o.question.scope === "per_cycle");
  const perPhase = outstanding.filter((o) => o.question.scope === "phase");

  // Who may read each of these questions, named. The answer form asks for
  // consent to the audiences that are actually on, one box each, and a form
  // cannot enumerate its own audiences — so the page resolves them and hands
  // them in. One batched read for the whole page, not one per question: this
  // page renders every outstanding question at once.
  const audiencesByQuestion = await listAudiencesForQuestions(
    viewing.communityId,
    outstanding.map((o) => o.question.id),
  );
  // Which of them each already-answered question has agreed to, so a member
  // returning to fix one field isn't shown boxes that don't match the
  // decisions they already made.
  const consentsByAnswer = await listAudienceConsentsForAnswers(
    outstanding.map((o) => o.existingAnswer?.id).filter((id): id is string => Boolean(id)),
  );

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">Your questions</h1>
      <p className="mb-6 mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
        Things your community has asked about you. Answer what you can — &ldquo;I don&rsquo;t know
        yet&rdquo; is a real answer and is never held against you. Anything already answered lives on
        your <Link href="/profile" className="text-[var(--accent-1)] hover:underline">profile</Link>.
      </p>

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {focus && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-2.5">
          <p className="text-[length:var(--text-body)] text-[var(--text)]">
            Showing what&rsquo;s needed for <strong className="font-semibold">{focus.name}</strong>
          </p>
          <Link href={`/${focus.id}/participation`} className="text-[length:var(--text-body)] font-medium text-[var(--accent-1)] hover:underline">
            Back to the event →
          </Link>
        </div>
      )}

      {outstanding.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] px-7 py-8 text-center">
          <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">Nothing outstanding — you&rsquo;re all caught up.</p>
          {focus && (
            <Link href={`/${focus.id}/participation`} className="text-[length:var(--text-body)] font-medium text-[var(--accent-1)] hover:underline">
              Back to {focus.name}
            </Link>
          )}
        </div>
      ) : (
        <>
          <QuestionGroup
            title="About you, once"
            blurb="These don't change between events — answer them once and you're done."
            items={onceEver}
            audiencesByQuestion={audiencesByQuestion}
            consentsByAnswer={consentsByAnswer}
            cycleId={null}
          />
          {perEvent.length > 0 && (
            <QuestionGroup
              title={focus ? `For ${focus.name}` : "For your current event"}
              blurb="Asked fresh for each event, since the answer can legitimately differ every time."
              items={perEvent}
              audiencesByQuestion={audiencesByQuestion}
              consentsByAnswer={consentsByAnswer}
              cycleId={focusCycleId}
            />
          )}
          {perPhase.length > 0 && (
            <QuestionGroup
              title="For this phase of the event"
              blurb="Asked again as the event moves through its phases."
              items={perPhase}
              audiencesByQuestion={audiencesByQuestion}
              consentsByAnswer={consentsByAnswer}
              cycleId={focusCycleId}
            />
          )}
        </>
      )}
    </main>
  );
}

async function QuestionGroup({
  title,
  blurb,
  items,
  audiencesByQuestion,
  consentsByAnswer,
  cycleId,
}: {
  title: string;
  blurb: string;
  items: Awaited<ReturnType<typeof listOutstandingQuestions>>;
  audiencesByQuestion: Map<string, Audience[]>;
  consentsByAnswer: Map<string, Set<string>>;
  // Stamped onto each form so a per-event answer lands against the event
  // this page is focused on rather than whatever the member last declared
  // on. Null for the once-ever group, which never carries an event.
  cycleId: string | null;
}) {
  const clock = await getViewerClock();
  if (items.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{title}</h2>
      <p className="mb-3 mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">{blurb}</p>
      <div className="flex flex-col gap-2">
        {items.map(({ question, existingAnswer }) => (
          <div key={`${question.id}-${cycleId ?? "once"}`} className={CARD}>
            <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">
              {question.label}
              {question.required ? " *" : ""}
              {question.requiredBy && (
                <span className="ml-2 text-[length:var(--text-meta)] font-normal text-[var(--text-muted)]">
                  needed by {clock.date(question.requiredBy)}
                </span>
              )}
            </p>
            {existingAnswer?.status === "deferred" && (
              <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">You said you didn&rsquo;t know yet.</p>
            )}
            <ProfileQuestionForm
              action={submitQuestionAnswerAction}
              questionId={question.id}
              cycleId={cycleId ?? undefined}
              shape={toFieldShape(question)}
              feedsCapacitySignal={question.feedsCapacitySignal}
              allowDeferral={question.allowDeferral}
              allowPreferNotToSay={question.allowPreferNotToSay}
              publishedAsIndicator={question.publishedAsIndicator}
              emergencyAccess={question.emergencyAccess}
              access={
                question.sensitive
                  ? {
                      kind: "restricted",
                      audiences: audiencesByQuestion.get(question.id) ?? [],
                      // Only a real answer has consents to restore; a
                      // deferral holds nothing, so its boxes start where
                      // the next real answer would.
                      defaultSharedRuleIds: existingAnswer
                        ? [...(consentsByAnswer.get(existingAnswer.id) ?? [])]
                        : undefined,
                    }
                  : { kind: "public" }
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}
