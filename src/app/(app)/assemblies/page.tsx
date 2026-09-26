import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import {
  assemblyTemplateTitle,
  FOUNDING_SETTINGS_TEMPLATE_KEY,
  FOUNDING_SETTINGS_TITLE,
  listAssemblies,
} from "@/lib/assemblies";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, Tag, type Tone } from "@/components/ui/kit";
import { relativeTime } from "@/components/assemblies/time";

export const dynamic = "force-dynamic";

const PHASE_LABEL: Record<string, string> = {
  agenda: "Agenda building",
  notice: "Notice — voting not open yet",
  voting: "Voting open",
  closed: "Closed",
};

const PHASE_TONE: Record<string, Tone> = {
  agenda: "neutral",
  notice: "neutral",
  voting: "warning",
  closed: "neutral",
};

// Which boundary is actually the next thing that happens, and the copy
// for it. The old list showed only a phase tag, so "which of these four
// open Assemblies closes today" was unanswerable without opening each
// one — which is the only reason to be on this page in the first place.
function nextBoundary(
  a: { agendaEndsAt: Date; noticeEndsAt: Date; votingEndsAt: Date; phase: string },
  now: Date,
): string {
  switch (a.phase) {
    case "agenda":
      return `Agenda closes ${relativeTime(a.agendaEndsAt, now)}`;
    case "notice":
      return `Voting opens ${relativeTime(a.noticeEndsAt, now)}`;
    case "voting":
      return `Voting closes ${relativeTime(a.votingEndsAt, now)}`;
    default:
      return `Closed ${a.votingEndsAt.toLocaleDateString()}`;
  }
}

function AssemblyRow({
  a,
  now,
}: {
  a: Awaited<ReturnType<typeof listAssemblies>>[number];
  now: Date;
}) {
  const templateTitle = assemblyTemplateTitle(a.templateKey);
  const open = a.phase !== "closed";
  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/assemblies/${a.id}`}
          className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]"
        >
          {a.title}
        </Link>
        <Tag tone={PHASE_TONE[a.phase]}>{PHASE_LABEL[a.phase] ?? a.phase}</Tag>
        {templateTitle && <Tag tone="accent2">Prepared agenda</Tag>}
      </div>

      <p className="mt-1 text-[12px] text-[var(--text-muted)]">
        {nextBoundary(a, now)}
        {a.questionCount > 0 && ` · ${a.questionCount} agenda ${a.questionCount === 1 ? "item" : "items"}`}
        {a.responseCount > 0 && ` · ${a.responseCount} ${a.responseCount === 1 ? "response" : "responses"}`}
      </p>

      {open && a.questionCount > 0 && (
        <p className="mt-1 text-[12px]">
          {a.myResponseCount > 0 ? (
            <span className="text-[var(--success)]">
              You&rsquo;ve answered {a.myResponseCount} of {a.questionCount}
            </span>
          ) : a.phase === "voting" ? (
            <span className="text-[var(--warning)]">You haven&rsquo;t answered anything yet</span>
          ) : null}
        </p>
      )}
    </div>
  );
}

// Community-wide decisions, not task-execution questions — see
// docs/spec.md's "Assemblies". No built-in urgent notification: this
// page (and each Assembly's own link) is the whole delivery mechanism.
export default async function AssembliesPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const assemblies = await listAssemblies(viewing);
  const now = new Date();
  const open = assemblies.filter((a) => a.phase !== "closed");
  const closed = assemblies.filter((a) => a.phase === "closed");
  // isAwaitingMyAnswer (src/lib/assemblies/crud.ts) is the single
  // definition, also read by the /community hub and the Community nav
  // badge — three surfaces that must never disagree about what's
  // outstanding.
  const needsMyAnswer = open.filter((a) => a.needsMyAnswer);
  const needsMyAnswerIds = new Set(needsMyAnswer.map((a) => a.id));
  // Listed *out* of "Open" rather than in addition to it — an Assembly
  // shown in both sections is just the same card twice.
  const restOpen = open.filter((a) => !needsMyAnswerIds.has(a.id));

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Assemblies</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Community-wide decisions — anything from a genuinely urgent one-off to a slower, deliberate
        structural question. Any member can propose one; results are always advisory, never applied
        automatically.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href="/assemblies/new" className={BUTTON_PRIMARY}>
          Propose an Assembly
        </Link>
        <Link
          href={`/assemblies/new?template=${FOUNDING_SETTINGS_TEMPLATE_KEY}`}
          className={BUTTON_SECONDARY}
        >
          Use the {FOUNDING_SETTINGS_TITLE} agenda
        </Link>
      </div>

      {assemblies.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-6 text-center">
          <p className="text-[13px] text-[var(--text)]">No Assemblies yet.</p>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            Anything the whole community should weigh in on belongs here — a placement decision, or a
            slower question about how the community runs itself.
          </p>
        </div>
      ) : (
        <>
          {needsMyAnswer.length > 0 && (
            <section className="mt-6">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Waiting on you
              </h2>
              <div className="mt-2 flex flex-col gap-2">
                {needsMyAnswer.map((a) => (
                  <AssemblyRow key={a.id} a={a} now={now} />
                ))}
              </div>
            </section>
          )}

          {restOpen.length > 0 && (
            <section className="mt-6">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Open
              </h2>
              <div className="mt-2 flex flex-col gap-2">
                {restOpen.map((a) => (
                  <AssemblyRow key={a.id} a={a} now={now} />
                ))}
              </div>
            </section>
          )}

          {closed.length > 0 && (
            <section className="mt-6">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Closed
              </h2>
              <div className="mt-2 flex flex-col gap-2">
                {closed.map((a) => (
                  <AssemblyRow key={a.id} a={a} now={now} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
