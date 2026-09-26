import Link from "next/link";
import { assemblyTemplateTitle, listOpenAssemblies } from "@/lib/assemblies";
import type { member as memberTable } from "@/db/schema";
import { relativeTime } from "@/components/assemblies/time";
import { CARD, Tag, type Tone } from "@/components/ui/kit";

type Member = typeof memberTable.$inferSelect;

// Kept in step with the phase labels/tone on /assemblies and the
// Assembly detail page. Small enough that three copies would drift, big
// enough to be worth sharing later — if that happens, lift these into
// src/lib/assemblies rather than adding a fourth inline copy.
const PHASE_LABEL: Record<string, string> = {
  agenda: "Agenda building",
  notice: "Notice — voting not open yet",
  voting: "Voting open",
};
const PHASE_TONE: Record<string, Tone> = {
  agenda: "neutral",
  notice: "neutral",
  voting: "warning",
};

function nextBoundary(
  a: { agendaEndsAt: Date; noticeEndsAt: Date; votingEndsAt: Date; phase: string },
  now: Date,
): string {
  switch (a.phase) {
    case "agenda":
      return `Agenda closes ${relativeTime(a.agendaEndsAt, now)}`;
    case "notice":
      return `Voting opens ${relativeTime(a.noticeEndsAt, now)}`;
    default:
      return `Voting closes ${relativeTime(a.votingEndsAt, now)}`;
  }
}

/**
 * Open Assemblies, on the Community hub.
 *
 * This is a passive listing, not a notification, and the distinction is
 * the whole design here. docs/spec.md is emphatic that an Assembly gets
 * "no built-in urgent notification, on purpose" — a human pastes the link
 * into whatever channel the community already uses. Putting the open
 * ones on the community's own hub doesn't break that: nothing is sent,
 * nothing interrupts, and a member who never looks at /community sees
 * exactly what they saw before. It's the same passive treatment the
 * "Current and upcoming events" cards above already get, which is why
 * this sits here rather than on the personal Dashboard — an Assembly is
 * a community-wide decision, and this is the community-wide page.
 *
 * The "needs you" marker and the sidebar badge that points at this
 * section both come from isAwaitingMyAnswer, so the three never
 * disagree about what's outstanding.
 */
export default async function CommunityAssembliesSection({ viewing }: { viewing: Member }) {
  const openAssemblies = await listOpenAssemblies(viewing);
  if (openAssemblies.length === 0) return null;

  const now = new Date();
  // Outstanding first, then by how soon each closes — the two orderings
  // that decide what a member does next, rather than newest-first.
  const ordered = [...openAssemblies].sort((a, b) => {
    if (a.needsMyAnswer !== b.needsMyAnswer) return a.needsMyAnswer ? -1 : 1;
    return a.votingEndsAt.getTime() - b.votingEndsAt.getTime();
  });
  const awaitingCount = ordered.filter((a) => a.needsMyAnswer).length;

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Open Assemblies
        </h2>
        {awaitingCount > 0 && (
          <span className="text-[12px] text-[var(--warning)]">
            {awaitingCount === 1
              ? "1 is waiting on your answer"
              : `${awaitingCount} are waiting on your answer`}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {ordered.map((a) => {
          const templateTitle = assemblyTemplateTitle(a.templateKey);
          return (
            <div key={a.id} className={CARD}>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/assemblies/${a.id}`}
                  className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]"
                >
                  {a.title}
                </Link>
                <Tag tone={PHASE_TONE[a.phase]}>{PHASE_LABEL[a.phase] ?? a.phase}</Tag>
                {templateTitle && <Tag tone="accent2">Prepared agenda</Tag>}
                {a.needsMyAnswer && <Tag tone="warning">Waiting on you</Tag>}
              </div>

              <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                {nextBoundary(a, now)}
                {a.questionCount > 0 &&
                  ` · ${a.questionCount} agenda ${a.questionCount === 1 ? "item" : "items"}`}
                {a.myResponseCount > 0 && ` · you've answered ${a.myResponseCount}`}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
