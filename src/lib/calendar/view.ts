import type { member as memberTable } from "@/db/schema";
import { effectiveTimeZone, localDateInZone, type PeriodDateContext } from "../dates";
import { getCurrentCycle, listOnceEverAnswers } from "../profile-questions";
import { getCycle } from "../cycles";
import { listMyTaskMilestones } from "../tasks";
import { listMyCalendarEvents } from "../calendar-events";
import { getNextCutoffAt } from "../input-rounds";
import { listAssemblies } from "../assemblies";
import { listPolls } from "../scheduling-polls";
import { listPublishedSchedule } from "../event-scheduling";
import { isModuleEnabled } from "../modules";
import { getCommunity } from "../settings";
import { getCurrentBudgetCycle } from "../budget";
import { listMySignupsWithOccurrence } from "../shifts";

type Member = typeof memberTable.$inferSelect;

export type CalendarEntryKind =
  | "phase_start"
  | "phase_end"
  | "milestone"
  | "calendar_event"
  | "input_round_cutoff"
  | "assembly_agenda_ends"
  | "assembly_notice_ends"
  | "assembly_voting_ends"
  | "poll_confirmed"
  | "event_confirmed"
  | "birthday"
  | "shift_occurrence"
  | "budget_deadline";

export interface CalendarEntry {
  date: string; // YYYY-MM-DD
  kind: CalendarEntryKind;
  label: string;
  href: string;
  /** Optional display-only context; never used for sorting or identity. */
  period?: PeriodDateContext | null;
}

// The calendar day a moment falls on *for the viewer*. Only for real
// instants — a deadline, a confirmed slot, a shift. A stored calendar
// date (a phase boundary, a milestone, a birthday) is already a day and
// must not be passed through here: 2026-09-14 is the 14th everywhere,
// and shifting it by a zone would move it.
function dayInZone(d: Date | string, timeZone: string): string {
  return localDateInZone(typeof d === "string" ? d : d.toISOString(), timeZone);
}

// A birthday's stored answer is one fixed YYYY-MM-DD with no year that
// still means anything on a forward-looking calendar — resolved as
// "the next time this month/day comes around," recomputed fresh on
// every read rather than stored, the same live-on-read posture this
// codebase defaults to everywhere it isn't a documented caching
// exception (see src/lib/dates/resolve.ts's own header comment).
function nextYearlyOccurrence(storedDate: string, today: string): string {
  const [, month, day] = storedDate.split("-");
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${month}-${day}`;
  return thisYear >= today ? thisYear : `${year + 1}-${month}-${day}`;
}

// The Calendar view's own read layer — docs/development-plan.md's
// Phase 44: "one Community-wide calendar reading every dated thing
// that already exists across the app as its own layer." Every source
// below is read as-is, no schema or scope changes to any of them (see
// that phase's own Depends-on list) — Phase boundaries/milestones/
// events are the current Cycle's / the actor's own; Input rounds,
// Assemblies, Scheduling polls, and Event scheduling are core (not
// module-gated) so every member sees the same community-wide layer
// there.
//
// Dates that are instants are placed on the day they fall on in the
// viewer's own zone — Member.timeZone, else the Community's, else UTC —
// while dates that are already plain days are left exactly as stored.
export async function getCalendarView(actor: Member) {
  const entries: CalendarEntry[] = [];

  const communityRow = await getCommunity(actor);
  const timeZone = effectiveTimeZone(actor, communityRow);
  const now = new Date();
  const today = dayInZone(now, timeZone);

  const currentCycle = await getCurrentCycle(actor.communityId);
  const currentCyclePeriod: PeriodDateContext | null =
    currentCycle?.startDate && currentCycle.endDate
      ? { name: currentCycle.name, startDate: currentCycle.startDate, endDate: currentCycle.endDate, cycleName: currentCycle.name }
      : null;
  const phasePeriods = new Map<string, PeriodDateContext>();
  if (currentCycle) {
    const withPhases = await getCycle(actor, currentCycle.id);
    for (const p of withPhases.phases) {
      const period =
        p.startDate && p.endDate
          ? { name: p.name, startDate: p.startDate, endDate: p.endDate }
          : null;
      if (period) phasePeriods.set(p.id, period);
      if (p.startDate) {
        entries.push({
          date: p.startDate,
          kind: "phase_start",
          label: `${p.name} starts`,
          href: "/participation",
          ...(period ? { period } : {}),
        });
      }
      if (p.endDate) {
        entries.push({
          date: p.endDate,
          kind: "phase_end",
          label: `${p.name} ends`,
          href: "/participation",
          ...(period ? { period } : {}),
        });
      }
    }
  }

  const myMilestones = await listMyTaskMilestones(actor);
  for (const m of myMilestones) {
    if (m.resolvedDate) {
      const parentPhase = m.parentType === "phase" ? phasePeriods.get(m.phaseId ?? m.taskPhaseId ?? "") : undefined;
      const period = parentPhase ?? (m.parentType === "cycle" && m.taskCycleId === currentCycle?.id ? currentCyclePeriod : null);
      entries.push({
        date: m.resolvedDate,
        kind: "milestone",
        label: `${m.label} — ${m.taskTitle}`,
        href: `/tasks/${m.taskId}`,
        ...(period ? { period } : {}),
      });
    }
  }

  const myEvents = await listMyCalendarEvents(actor);
  for (const e of myEvents) {
    if (e.date) {
      entries.push({
        date: e.date,
        kind: "calendar_event",
        label: e.title,
        href: "/calendar",
        ...(e.cycleId === currentCycle?.id && currentCyclePeriod ? { period: currentCyclePeriod } : {}),
      });
    }
  }

  const nextCutoff = await getNextCutoffAt(actor);
  if (nextCutoff) {
    entries.push({ date: dayInZone(nextCutoff, timeZone), kind: "input_round_cutoff", label: "Input round cutoff", href: "/input-rounds" });
  }

  const assemblies = await listAssemblies(actor);
  for (const a of assemblies) {
    if (a.phase === "closed") continue; // a settled Assembly stops being calendar-relevant
    entries.push({ date: dayInZone(a.agendaEndsAt, timeZone), kind: "assembly_agenda_ends", label: `${a.title} — agenda closes`, href: "/assemblies" });
    entries.push({ date: dayInZone(a.noticeEndsAt, timeZone), kind: "assembly_notice_ends", label: `${a.title} — notice ends`, href: "/assemblies" });
    entries.push({ date: dayInZone(a.votingEndsAt, timeZone), kind: "assembly_voting_ends", label: `${a.title} — voting closes`, href: "/assemblies" });
  }

  const polls = await listPolls(actor);
  for (const poll of polls) {
    // Only a resolved poll produces a single dated moment worth
    // plotting — an open-ended availability range isn't "a date" yet.
    if (poll.confirmedSlotStart) {
      entries.push({ date: dayInZone(poll.confirmedSlotStart, timeZone), kind: "poll_confirmed", label: poll.title, href: "/scheduling-polls" });
    }
  }

  const publishedSchedule = await listPublishedSchedule(actor);
  for (const p of publishedSchedule) {
    const slot = p.confirmedSlot as { startsAt: string; endsAt: string } | null;
    if (p.status === "confirmed" && slot?.startsAt) {
      entries.push({ date: dayInZone(slot.startsAt, timeZone), kind: "event_confirmed", label: p.title, href: "/schedule" });
    }
  }

  // Shifts and Budget both predate this view (Phases 29-30, 26-27) but
  // never got picked up as a layer here — see docs/development-plan.md's
  // Phase 49. A member's own upcoming signed-up occurrences (not every
  // occurrence community-wide, matching every other layer here staying
  // "the actor's own" wherever that reading applies).
  if (isModuleEnabled(communityRow, "shifts")) {
    const mySignups = await listMySignupsWithOccurrence(actor);
    for (const s of mySignups) {
      if (s.signup.status === "signed_up" && new Date(s.occurrence.startsAt) >= now) {
        entries.push({
          date: dayInZone(s.occurrence.startsAt, timeZone),
          kind: "shift_occurrence",
          label: `${s.series.title} shift`,
          href: "/shifts",
        });
      }
    }
  }

  // The current BudgetCycle's own proposal deadline, while it's still
  // meaningful (proposals_open) — visible to every member the same way
  // /budget itself already is, not a new restriction.
  if (isModuleEnabled(communityRow, "budget")) {
    const budgetCycle = await getCurrentBudgetCycle(actor);
    if (budgetCycle && budgetCycle.status === "proposals_open") {
      entries.push({
        date: dayInZone(budgetCycle.proposalDeadline, timeZone),
        kind: "budget_deadline",
        label: `${budgetCycle.title} — proposal deadline`,
        href: "/budget",
      });
    }
  }

  const onceEverAnswers = await listOnceEverAnswers(actor);
  for (const { question, answer } of onceEverAnswers) {
    if (question.responseType === "date" && typeof answer.value === "string") {
      entries.push({
        date: nextYearlyOccurrence(answer.value, today),
        kind: "birthday",
        label: `${question.label} (yours)`,
        href: "/profile",
      });
    }
  }

  entries.sort((a, b) => a.date.localeCompare(b.date));
  return {
    currentCycle: currentCycle ? { id: currentCycle.id, name: currentCycle.name } : null,
    entries,
    // What the entries above were placed in, and which day that makes
    // "today" — the page needs both, and deriving them again there is how
    // the grid and the list would end up disagreeing.
    timeZone,
    today,
  };
}
