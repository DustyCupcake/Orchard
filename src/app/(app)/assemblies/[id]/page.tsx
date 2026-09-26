import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { formatFieldValue } from "@/lib/field-shape";
import {
  assemblyTemplateTitle,
  FOUNDING_SETTINGS_TITLE,
  getAssembly,
  templateGroupForMapping,
} from "@/lib/assemblies";
import {
  Banner,
  CARD,
  Tag,
  type Tone,
} from "@/components/ui/kit";
import AgendaItemForm from "@/components/assemblies/AgendaItemForm";
import BallotForm, { type BallotValue } from "@/components/assemblies/BallotForm";
import QuestionShape from "@/components/assemblies/QuestionShape";
import { relativeTime } from "@/components/assemblies/time";
import {
  addAgendaItemAction,
  removeAgendaItemAction,
  submitAssemblyResponsesAction,
} from "./actions";

export const dynamic = "force-dynamic";

const PHASE_LABEL: Record<string, string> = {
  agenda: "Agenda building — anyone can add an item",
  notice: "Notice — agenda locked, voting opens soon",
  voting: "Voting open",
  closed: "Closed",
};

const PHASE_TONE: Record<string, Tone> = {
  agenda: "neutral",
  notice: "neutral",
  voting: "warning",
  closed: "neutral",
};



export default async function AssemblyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { id } = await params;
  const { error } = await searchParams;
  const a = await getAssembly(viewing, id);
  const now = new Date();

  const [communityMembers] = await Promise.all([
    db.select({ id: member.id, name: member.name }).from(member).where(eq(member.communityId, viewing.communityId)),
  ]);
  const memberNameById = new Map(communityMembers.map((m) => [m.id, m.name]));
  const memberCount = communityMembers.length;

  const templateTitle = assemblyTemplateTitle(a.templateKey);
  const questions = a.questions;
  const answeredCount = questions.filter((q) => q.myResponse !== null).length;
  const respondedMemberIds = new Set(questions.flatMap((q) => q.responses.map((r) => r.memberId)));
  const notYetResponded = Math.max(0, memberCount - respondedMemberIds.size);

  // Template items are listed under their own section headings; a
  // hand-written agenda stays a single flat list, which is what its
  // author would expect.
  const isTemplate = Boolean(templateTitle);
  const groupOrder: string[] = isTemplate
    ? [...new Set(questions.map((q) => templateGroupForMapping(q.settingsMapping)).filter((g): g is string => Boolean(g)))]
    : [];

  // An arrow const rather than a function declaration: declarations are
  // hoisted, so TS won't carry the `viewing` narrowing above into them.
  const renderQuestion = (q: (typeof questions)[number]) => {
    const isChoice = q.responseType === "single_choice" || q.responseType === "multi_choice";
    // Options are the vote form's own controls while voting is open, so
    // the standalone list would just print them twice.
    const showAnswers = a.phase !== "voting";
    const total = q.responses.length;
    // Responses that aren't any listed option — only possible on an item
    // with the escape hatch on. Counted separately so the tally below
    // can account for them rather than dropping them.
    const otherTexts = q.responses.filter((r) => {
      const v = r.value as string | string[];
      return (Array.isArray(v) ? v : [v]).some((x) => typeof x === "string" && !q.options.includes(x));
    });
    const lastResponseAt = q.responses.reduce<Date | null>(
      (latest, r) => (!latest || r.answeredAt > latest ? r.answeredAt : latest),
      null,
    );
    const addedByName = memberNameById.get(q.addedBy) ?? "Someone";

    return (
      <div key={q.id} className={CARD}>
        <p className="text-[14px] font-medium text-[var(--text)]">{q.text}</p>

        <QuestionShape
          responseType={q.responseType}
          options={q.options}
          allowOther={q.allowOther}
          showAnswers={showAnswers}
        />

        {/* Who put this here. An agenda anyone can add to is a shared
            document, and "who wants this decided?" is the first
            question a member asks reading someone else's motion. */}
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
          Added by {q.addedBy === viewing.id ? "you" : addedByName}
        </p>

        {q.settingsMapping && (
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            Applies to: {q.settingsMapping}
          </p>
        )}

        {/* Response count on every item, in every phase — during
            agenda-building it's the only signal of whether anything is
            happening, and during voting it's the "how many of us are we
            actually waiting on" number the old page never showed. */}
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
          {total === 0
            ? "No responses yet"
            : `${total} ${total === 1 ? "response" : "responses"}`}
          {a.phase === "voting" && q.myResponse === null && total > 0 && " · you haven’t answered this one yet"}
          {lastResponseAt && a.phase === "voting" && ` · last one ${relativeTime(lastResponseAt, now)}`}
        </p>

        {/* Withdrawing your own item is only possible while the agenda
            is open, and only ever your own — see removeAgendaItem. */}
        {a.phase === "agenda" && q.addedBy === viewing.id && (
          <form action={removeAgendaItemAction} className="mt-2">
            <input type="hidden" name="assemblyId" value={a.id} />
            <input type="hidden" name="questionId" value={q.id} />
            <button
              type="submit"
              className="w-fit text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--danger)] hover:underline"
            >
              Withdraw this item
            </button>
          </form>
        )}

        {isChoice && total > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {/* Rows include the escape hatch's own answers, so the bars
                still sum to the response count above. Before an item
                could offer "other", every response was attributable to
                some option; now one can be a person's own words, and
                silently omitting it from the tally would make the
                percentages quietly disagree with the "N responses"
                line directly above. Counted as a visible row rather
                than folded into an option — same reasoning as showing
                the "other" bucket in a community indicator. */}
            {[...q.options, ...(otherTexts.length > 0 ? ["wrote their own answer"] : [])].map((o) => {
              const isOtherRow = o === "wrote their own answer";
              const count = isOtherRow
                ? otherTexts.length
                : q.responses.filter((r) => {
                    const v = r.value as string | string[];
                    return Array.isArray(v) ? v.includes(o) : v === o;
                  }).length;
              const mine = q.responseType === "single_choice"
                ? q.myResponse?.value === o
                : Array.isArray(q.myResponse?.value) && q.myResponse.value.includes(o);
              const share = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <li key={o}>
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className={mine ? "font-medium text-[var(--accent-1)]" : "text-[var(--text)]"}>
                      {/* The space is load-bearing, not decoration: without
                          it the text content reads "Yes, weeklyyour
                          answer" to a screen reader and on copy-paste,
                          even though the margin makes it look right. */}
                      {o}
                      {mine && (
                        <span className="ml-1.5 text-[11px] font-normal"> your answer</span>
                      )}
                    </span>
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {count} · {share}%
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 w-full overflow-hidden rounded-[var(--radius-sm)] bg-[var(--surface-sunken)]">
                    <div
                      className="h-full rounded-[var(--radius-sm)] bg-[var(--accent-1)]"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!isChoice && total > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {q.responses.map((r) => {
              const mine = r.memberId === viewing.id;
              return (
                <li
                  key={r.id}
                  className={`rounded-[var(--radius-sm)] px-2 py-1 text-[13px] ${
                    mine
                      ? "bg-[var(--accent-1-softer)] text-[var(--accent-1)]"
                      : "bg-[var(--surface-sunken)] text-[var(--text)]"
                  }`}
                >
                  <span className="font-medium">
                    {mine ? "You" : (memberNameById.get(r.memberId) ?? "Someone")}
                  </span>
                  {": "}
                  {formatFieldValue(r.value, q.responseType)}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">{a.title}</h1>
      {a.description && <p className="mt-2 text-[13px] text-[var(--text)]">{a.description}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Tag tone={PHASE_TONE[a.phase]}>{PHASE_LABEL[a.phase] ?? a.phase}</Tag>
        {templateTitle && <Tag tone="accent2">Prepared agenda</Tag>}
      </div>

      {/* The one question a member opens this page with is "is there
          still time", so the phase boundary leads with an answer and
          keeps the absolute timestamp underneath for the plan-down-to-
          the-hour case. */}
      {a.phase === "agenda" && (
        <p className="mt-2 text-[13px] text-[var(--text)]">
          You can add to the agenda for another{" "}
          <strong>{relativeTime(a.agendaEndsAt, now)}</strong> — it closes{" "}
          {a.agendaEndsAt.toLocaleString()}.
        </p>
      )}
      {a.phase === "notice" && (
        <p className="mt-2 text-[13px] text-[var(--text)]">
          Voting opens <strong>{relativeTime(a.noticeEndsAt, now)}</strong> — at{" "}
          {a.noticeEndsAt.toLocaleString()}. The agenda is locked but fully readable below.
        </p>
      )}
      {a.phase === "voting" && (
        <p className="mt-2 text-[13px] text-[var(--text)]">
          Voting closes <strong>{relativeTime(a.votingEndsAt, now)}</strong> —{" "}
          {a.votingEndsAt.toLocaleString()}.
        </p>
      )}
      {a.phase === "closed" && (
        <p className="mt-2 text-[13px] text-[var(--text-muted)]">
          Closed {a.votingEndsAt.toLocaleString()}. Results below are final — turning any of this
          into an actual change is a separate, deliberate step someone takes by hand.
        </p>
      )}

      {a.phase === "voting" && questions.length > 0 && (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
          <p className="text-[13px] text-[var(--text)]">
            {answeredCount === questions.length ? (
              <>
                You&rsquo;ve answered all {questions.length}.
              </>
            ) : (
              <>
                You&rsquo;ve answered {answeredCount} of {questions.length}.
              </>
            )}
            {notYetResponded > 0 && ` ${notYetResponded} of ${memberCount} members haven’t answered anything yet.`}
          </p>
        </div>
      )}

      {isTemplate && a.phase !== "closed" && (
        <div className="mt-3">
          <Banner tone="warning">
            This Assembly started from the prepared {FOUNDING_SETTINGS_TITLE} agenda — the settings a
            community has to decide together before it can really run. Every item is editable, and
            anything you&rsquo;ve already settled can just be deleted. Results stay advisory: when
            voting closes, each answer is printed next to the setting it applies to.
          </Banner>
        </div>
      )}

      {isTemplate && a.phase === "closed" && (
        <div className="mt-3">
          <Banner tone="success">
            These results are advisory. Each answer below is shown next to the setting it applies
            to — whoever holds Admins now makes those changes by hand, in the order that makes sense
            for this community.
          </Banner>
        </div>
      )}

      <details className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
        <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">
          What&rsquo;s an Assembly?
        </summary>
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
          A way to gather the whole community&rsquo;s view on something — anything from a genuinely
          urgent one-off to a slower, deliberate structural question. It moves through four phases:
        </p>
        <ul className="mt-1.5 flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">
          <li>
            <strong className="text-[var(--text)]">Agenda</strong> — any member can add agenda
            items: the specific questions or motions people will vote on.
          </li>
          <li>
            <strong className="text-[var(--text)]">Notice</strong> — the agenda is locked and
            visible, but voting hasn&rsquo;t opened yet.
          </li>
          <li>
            <strong className="text-[var(--text)]">Voting</strong> — members vote on each agenda
            item.
          </li>
          <li>
            <strong className="text-[var(--text)]">Closed</strong> — voting has ended and results
            are final.
          </li>
        </ul>
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
          Results are always advisory, never applied automatically — turning any of this into an
          actual change is a separate, deliberate step someone takes by hand.
        </p>
      </details>

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {questions.length === 0 && (
        <p className="mt-6 text-[13px] text-[var(--text-muted)]">
          No agenda items yet.
          {a.phase === "agenda" && " Add the first one below — anyone can."}
        </p>
      )}

      {/* The ballot sits above the results rather than inside each item:
          voting is one act, so it's one control in one place, and the
          per-item tallies below become the review of what you just
          saved instead of sharing a card with the inputs. */}
      {a.phase === "voting" && questions.length > 0 && (
        <div className="mt-6">
          <BallotForm
            action={submitAssemblyResponsesAction}
            assemblyId={a.id}
            questions={questions.map((q) => ({
              id: q.id,
              text: q.text,
              responseType: q.responseType,
              options: q.options,
              // The shape flags, so the ballot renders the controls the
              // item was authored to be answered with rather than
              // assuming every non-choice item is prose — the mistake
              // QuestionShape used to make.
              multiline: q.multiline,
              allowOther: q.allowOther,
              min: q.min,
              max: q.max,
              myValue: (q.myResponse?.value as BallotValue | undefined) ?? null,
              responseCount: q.responses.length,
            }))}
          />
        </div>
      )}

      {a.phase === "voting" && questions.length > 0 && (
        <h2 className="mt-8 text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          What everyone has said so far
        </h2>
      )}

      {groupOrder.length > 0 ? (
        <div className="mt-6 flex flex-col gap-5">
          {groupOrder.map((group) => (
            <section key={group}>
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {group}
              </h2>
              <div className="mt-2 flex flex-col gap-2">
                {questions
                  .filter((q) => templateGroupForMapping(q.settingsMapping) === group)
                  .map(renderQuestion)}
              </div>
            </section>
          ))}
          {questions.filter((q) => !templateGroupForMapping(q.settingsMapping)).length > 0 && (
            <section>
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Added during the window
              </h2>
              <div className="mt-2 flex flex-col gap-2">
                {questions
                  .filter((q) => !templateGroupForMapping(q.settingsMapping))
                  .map(renderQuestion)}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">{questions.map(renderQuestion)}</div>
      )}

      {a.phase === "agenda" && <AgendaItemForm action={addAgendaItemAction} assemblyId={a.id} />}
    </main>
  );
}
