import Link from "next/link";
import { CalendarBlank, Users } from "@phosphor-icons/react/dist/ssr";
import { getCycleParticipationSummary, getMyParticipation, listOpenEventParticipationCards, type OpenEventParticipationCard } from "@/lib/participation";
import type { member as memberTable } from "@/db/schema";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, Tag } from "./ui/kit";

type Member = typeof memberTable.$inferSelect;

// The two surfaces below both let a member say whether they're coming
// without making them go find the event first. Shared by the Dashboard
// and the Community hub rather than written twice; each page passes its
// own server action (src/app/(app)/dashboard/actions.ts's and
// community/actions.ts's declareEventStatusAction — same body, different
// revalidation target, matching every other page's actions.ts owning its
// own) the same way PrefilledAnswersReview already takes one as a prop.
//
// This is deliberately a *status-only* control. The full form on
// /participation — arrival/departure dates, a note — stays there; what's
// here is "are you in or not", which is the thing a member actually knows
// at a glance and the thing that otherwise has no home until they
// navigate to the right event.

const STATUS_LABEL: Record<string, string> = {
  coming: "Coming",
  maybe: "Maybe",
  not_coming: "Not coming",
};

// Offered as one-click buttons, in the order someone actually decides in.
const CHOICES = ["coming", "maybe", "not_coming"] as const;

// A community that somehow has more open events than this gets a link to
// the full Events page rather than an unbounded stack of cards on a
// dashboard. In practice this is nearly always 1 (see createCycle).
const MAX_CARDS = 4;

// "12–16 Apr 2027" / "From 12 Apr" / "Dates not set yet" — the event's own
// start/end (Phase 39's working dates), not startedAt, which is just the
// admin log of when the row was created.
function dateRange(startDate: string | null, endDate: string | null): string {
  if (!startDate && !endDate) return "Dates not set yet";
  const fmt = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (startDate && endDate) {
    return startDate === endDate ? fmt(startDate) : `${fmt(startDate)}–${fmt(endDate)}`;
  }
  return startDate ? `From ${fmt(startDate)}` : `Until ${fmt(endDate!)}`;
}

// Takes only the three fields it actually reads, so the cards below and
// the ribbon's own getCycleParticipationSummary result can both pass one.
function participationCount(counts: Pick<OpenEventParticipationCard, "capacity" | "comingCount" | "holds">) {
  const { capacity, comingCount, holds } = counts;
  const base = capacity === null ? `${comingCount} coming` : `${comingCount} of ${capacity} coming`;
  // Held slots are outstanding invites that will become a place if they're
  // accepted — real information for someone deciding whether to commit,
  // and counted the same way /participation counts them.
  return holds > 0 ? `${base} · ${holds} held` : base;
}

function StatusButtons({
  cycleId,
  myStatus,
  action,
  variant = "segmented",
}: {
  cycleId: string;
  myStatus: OpenEventParticipationCard["myStatus"];
  action: (formData: FormData) => Promise<void>;
  // "segmented" is the full three-way answer, for a card that has room for
  // it. "single" is the ribbon's one nudge — see EventComingRibbon for why
  // it doesn't also offer Maybe/Not coming.
  variant?: "segmented" | "single";
}) {
  if (variant === "single") {
    return (
      <form action={action}>
        <input type="hidden" name="cycleId" value={cycleId} />
        <button type="submit" name="status" value="coming" className={BUTTON_PRIMARY}>
          I&rsquo;m coming
        </button>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="cycleId" value={cycleId} />
      {CHOICES.map((choice) => {
        const selected = myStatus === choice;
        const classes = selected
          ? "rounded-[var(--radius-md)] border border-[var(--accent-1)] bg-[var(--accent-1-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--accent-1)]"
          : "rounded-[var(--radius-md)] border border-[var(--border)] bg-transparent px-2.5 py-1 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--neutral-100)]";
        return (
          <button
            key={choice}
            type="submit"
            name="status"
            value={choice}
            className={classes}
            aria-pressed={selected}
          >
            {STATUS_LABEL[choice]}
          </button>
        );
      })}
      {/* Someone who said "maybe" three times and is now sure they're out
          still needs a way back to silence — the full form's select has
          offered "Haven't said" this whole time. */}
      {myStatus !== "unknown" && (
        <button type="submit" name="status" value="unknown" className={BUTTON_SECONDARY + " px-2 py-1 text-[12px]"}>
          Clear
        </button>
      )}
    </form>
  );
}

// "Current and upcoming events" — one long horizontal card per open event:
// name, dates, how many people are coming (out of a cap when one is set),
// and a one-click way to say where you stand. Rendered on the Community
// hub unconditionally, and on the Dashboard whenever the nav switcher
// isn't already narrowed to one specific event (a member sitting inside
// an event's view is already looking at that event, so repeating every
// open one above it would be noise — see DashboardPage's own call site).
export async function EventParticipationCards({
  viewing,
  action,
}: {
  viewing: Member;
  action: (formData: FormData) => Promise<void>;
}) {
  const cards = await listOpenEventParticipationCards(viewing);
  const shown = cards.slice(0, MAX_CARDS);

  return (
    <section className="mt-6">
      <h2 className="text-[22px] font-semibold text-[var(--text)]">Current and upcoming events</h2>
      {shown.length === 0 ? (
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          No open events right now — there&rsquo;s nothing to declare yet.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-2">
            {shown.map((card) => (
              <div key={card.id} className={CARD}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Link
                    href={`/${card.id}/participation`}
                    className="text-[15px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]"
                  >
                    {card.name}
                  </Link>
                  <span className="inline-flex items-center gap-1 text-[13px] text-[var(--text-muted)]">
                    <CalendarBlank size={14} />
                    {dateRange(card.startDate, card.endDate)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2">
                  <StatusButtons cycleId={card.id} myStatus={card.myStatus} action={action} />
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
                    <Users size={14} />
                    {participationCount(card)}
                    {/* Over capacity is a real, visible number everywhere
                        else in this app (the Events page says "N over
                        capacity") — not clamped, not hidden. */}
                    {card.remainingCapacity !== null && card.remainingCapacity < 0 && (
                      <Tag tone="warning">{Math.abs(card.remainingCapacity)} over capacity</Tag>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {cards.length > MAX_CARDS && (
            <Link href="/participation" className="mt-2 inline-block text-[13px] font-medium text-[var(--accent-1)] hover:underline">
              See all {cards.length} open events →
            </Link>
          )}
        </>
      )}
    </section>
  );
}

// "You're not down as coming for <this one event>" — the Dashboard's top
// ribbon when the nav switcher IS narrowed to a specific event, i.e.
// exactly the case where the cards strip above is deliberately not
// rendered. Returns null once the member has said they're coming, so
// there's no standing nag on someone who's already answered it: plans
// change, but they don't need reminding about something they already
// told us.
//
// "Maybe" and "Not coming" both count as not-coming for this purpose, on
// the same reading declareParticipation's "resubmittable as plans
// change" and this app's nudge-never-a-gate posture both point to: the
// honest statement is "you're not currently counted among the people
// coming". The button is deliberately the only control here rather than
// the card's full three-way segmented control — a ribbon that can't be
// scrolled past shouldn't also be asking for a considered answer, and
// everything else (including Maybe/Not coming) is one click away on the
// event's own page.
export async function EventComingRibbon({
  viewing,
  cycle,
  action,
}: {
  viewing: Member;
  // Already-resolved by the caller: the Dashboard only reaches here with
  // the single cycle its nav switcher is scoped to.
  cycle: { id: string; name: string; startDate: string | null; endDate: string | null; closedAt: Date | null };
  action: (formData: FormData) => Promise<void>;
}) {
  // A closed event is read-only for everyone (requireCycleOpen), so a
  // declaration button would be a dead end — no ribbon at all.
  if (cycle.closedAt) return null;

  // The ribbon needs the same two facts the cards get, but scoped to one
  // already-resolved event. Called directly rather than by filtering
  // listOpenEventParticipationCards, which would re-list and re-summarize
  // every open event to use one of them.
  const [summary, mine] = await Promise.all([
    getCycleParticipationSummary(viewing, cycle.id),
    getMyParticipation(viewing, cycle.id),
  ]);
  if (mine.status === "coming") return null;

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--accent-1-border)] bg-[var(--accent-1-soft)] px-4 py-3">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-[var(--accent-1)]">
          You&rsquo;re not down as coming for{" "}
          <Link href={`/${cycle.id}/participation`} className="underline hover:no-underline">
            {cycle.name}
          </Link>
          .
        </p>
        <p className="mt-0.5 text-[13px] text-[var(--accent-1)]">
          {dateRange(cycle.startDate, cycle.endDate)} · {participationCount(summary)}
        </p>
      </div>
      <StatusButtons cycleId={cycle.id} myStatus={mine.status} action={action} variant="single" />
    </div>
  );
}
