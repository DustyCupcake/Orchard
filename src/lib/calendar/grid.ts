import { addDays } from "../dates";

// Pure month-grid math, no DB — shared by /calendar itself and the
// Pack-import date preview (docs/development-plan.md's Phase 44 names
// "calendar or list view, toggled by the reviewer" for the latter).
// Weeks always run Sunday-first and always span whole weeks (leading/
// trailing days from the adjacent month included, marked !inMonth), so
// every month renders as a complete 7-wide grid with no ragged edges.
export interface MonthGridDay {
  date: string; // YYYY-MM-DD
  inMonth: boolean;
  isToday: boolean;
}

export function buildMonthGrid(year: number, month: number /* 1-12 */, today: Date = new Date()): MonthGridDay[][] {
  const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  const startWeekday = new Date(`${firstOfMonth}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const todayStr = today.toISOString().slice(0, 10);

  const cells: MonthGridDay[] = [];
  for (let i = startWeekday; i > 0; i--) {
    const date = addDays(firstOfMonth, -i);
    cells.push({ date, inMonth: false, isToday: date === todayStr });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = addDays(firstOfMonth, day - 1);
    cells.push({ date, inMonth: true, isToday: date === todayStr });
  }
  while (cells.length % 7 !== 0) {
    const date = addDays(cells[cells.length - 1].date, 1);
    cells.push({ date, inMonth: false, isToday: date === todayStr });
  }

  const weeks: MonthGridDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

// "YYYY-MM" — the query-param shape both /calendar and the clone
// preview use for month navigation (plain GET links, no client JS,
// matching this codebase's dominant server-rendered posture).
export function parseMonthParam(param: string | undefined, today: Date = new Date()): { year: number; month: number } {
  const match = param?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    return { year: Number(match[1]), month: Number(match[2]) };
  }
  return { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (((total % 12) + 12) % 12) + 1 };
}

export function monthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export const MONTH_LABEL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
