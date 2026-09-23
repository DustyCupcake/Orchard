import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { cycle, shiftOccurrence, shiftSeries, shiftSignup } from "@/db/schema";
import type { cycle as cycleTable, member as memberTable, shiftOccurrence as shiftOccurrenceTable, shiftSeries as shiftSeriesTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { resolveShiftManager, isShiftManagerForScope } from "./management";
import { effectiveCapacity } from "./occurrences";

type Member = typeof memberTable.$inferSelect;
type CycleRow = typeof cycleTable.$inferSelect;
type ShiftSeriesRow = typeof shiftSeriesTable.$inferSelect;
type ShiftOccurrenceRow = typeof shiftOccurrenceTable.$inferSelect;

export interface RosterOccurrenceItem {
  occurrence: ShiftOccurrenceRow;
  capacity: number;
  signupCount: number;
}

export interface RosterSeriesItem {
  series: ShiftSeriesRow;
  // null = an unconfirmed proposal (invisible to sign-ups and the
  // browse surface until the cycle's manager confirms it).
  confirmedAt: Date | null;
  occurrences: RosterOccurrenceItem[];
}

export interface CycleRoster {
  cycle: CycleRow;
  manager: Member | null;
  isManager: boolean;
  // The one-way open act (D11): false = collecting window — confirmed
  // series are visible but sign-ups stay closed; proposals aside, this
  // is what the page renders as "Collecting — sign-ups closed".
  signupsOpened: boolean;
  openedAt: Date | null;
  series: RosterSeriesItem[];
}

// The roster of a specific cycle, assembled as a single object both the
// cycle view (participation page) and /shifts render — manager, window
// state, and every series with its occurrence fill counts, drawn from
// the shift_management grant + existing signup data (docs/cycle-scope-
// remediation-plan.md §5.6). Viewable by any member of the community,
// unlike management actions; proposals are included here so a manager
// sees what's pending confirmation, while the browse surface hides them.
export async function getCycleShiftRoster(actor: Member, cycleId: string): Promise<CycleRoster> {
  const [cycleRow] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
  if (!cycleRow) {
    throw new NotFoundError("Cycle not found");
  }

  const [manager, isManager] = await Promise.all([
    resolveShiftManager(actor.communityId, cycleId),
    isShiftManagerForScope(actor, cycleId),
  ]);

  const seriesRows = await db
    .select()
    .from(shiftSeries)
    .where(and(eq(shiftSeries.cycleId, cycleId), isNull(shiftSeries.archivedAt)))
    .orderBy(desc(shiftSeries.createdAt));

  const seriesItems: RosterSeriesItem[] = [];
  if (seriesRows.length > 0) {
    const occurrencesBySeries = new Map<string, ShiftOccurrenceRow[]>();
    const allOccurrences = await db
      .select()
      .from(shiftOccurrence)
      .where(inArray(shiftOccurrence.seriesId, seriesRows.map((s) => s.id)))
      .orderBy(asc(shiftOccurrence.startsAt));
    for (const o of allOccurrences) {
      const list = occurrencesBySeries.get(o.seriesId) ?? [];
      list.push(o);
      occurrencesBySeries.set(o.seriesId, list);
    }

    const allOccurrenceIds = allOccurrences.map((o) => o.id);
    const countByOccurrenceId = new Map<string, number>();
    if (allOccurrenceIds.length > 0) {
      const signupRows = await db
        .select({ occurrenceId: shiftSignup.occurrenceId })
        .from(shiftSignup)
        .where(inArray(shiftSignup.occurrenceId, allOccurrenceIds));
      for (const s of signupRows) {
        countByOccurrenceId.set(s.occurrenceId, (countByOccurrenceId.get(s.occurrenceId) ?? 0) + 1);
      }
    }

    for (const s of seriesRows) {
      const occurrences = (occurrencesBySeries.get(s.id) ?? []).map((o) => ({
        occurrence: o,
        capacity: effectiveCapacity(o, s),
        signupCount: countByOccurrenceId.get(o.id) ?? 0,
      }));
      seriesItems.push({ series: s, confirmedAt: s.confirmedAt, occurrences });
    }
  }

  return {
    cycle: cycleRow,
    manager,
    isManager,
    signupsOpened: cycleRow.shiftSignupsOpenedAt !== null,
    openedAt: cycleRow.shiftSignupsOpenedAt,
    series: seriesItems,
  };
}