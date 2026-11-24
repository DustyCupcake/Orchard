import type { ReactNode } from "react";
import { AXIS_STEP_MINUTES, clockOfOffset } from "@/lib/shifts/views";

/** How a block reads at a glance: whether you can still join it. */
export type GridTone = "open" | "mine" | "full" | "closed" | "more";

/**
 * One block on the grid: a period of the 6am–6am day, in minutes after its
 * 06:00, drawn in one lane of an overlapping cluster (`lane` of `lanes`).
 */
export interface GridBlock {
  key: string;
  startOffset: number;
  endOffset: number;
  lane: number;
  lanes: number;
  tone: GridTone;
  content: ReactNode;
}

/** One column of the grid: a day and the blocks on it. */
export interface GridColumn {
  day: string;
  label: string;
  blocks: GridBlock[];
}

const ROW_H_PX = 16;
const PX_PER_MINUTE = ROW_H_PX / AXIS_STEP_MINUTES;

const TONE: Record<GridTone, string> = {
  open: "border-[var(--accent-1)] bg-[var(--accent-1-soft)]",
  mine: "border-[var(--success-border)] bg-[var(--success-soft)]",
  full: "border-[var(--border)] bg-[var(--surface-sunken)] opacity-80",
  closed: "border-[var(--warning-border)] bg-[var(--warning-soft)]",
  more: "border-dashed border-[var(--border)] bg-[var(--surface)]",
};

/**
 * The day-columns calendar grid: a column per day sharing one time-of-day
 * axis down the side, with each block drawn at its offset into the day. The
 * axis runs from `fromOffset` to `toOffset` (minutes after 06:00), so
 * nothing above the first shift or below the last takes up room. Blocks that
 * overlap sit side by side in lanes. Generic: anything with days and offsets
 * can reuse it; what a block says and does is its `content`.
 */
export default function DayColumnsGrid({
  columns,
  fromOffset,
  toOffset,
}: {
  columns: GridColumn[];
  /** The top of the axis, in minutes after 06:00. */
  fromOffset: number;
  /** The bottom of the axis, in minutes after 06:00. */
  toOffset: number;
}) {
  const rowCount = Math.max(1, Math.ceil((toOffset - fromOffset) / AXIS_STEP_MINUTES));
  const rows = Array.from({ length: rowCount }, (_, i) => fromOffset + i * AXIS_STEP_MINUTES);
  const gridHeight = rowCount * ROW_H_PX;

  return (
    <div className="overflow-auto rounded-[var(--radius-md)] border border-[var(--border)]">
      <div className="flex">
        <div className="sticky left-0 z-10 flex shrink-0 flex-col bg-[var(--surface)]">
          <div className="h-10 w-10" />
          {rows.map((offset) => {
            const clock = clockOfOffset(offset);
            return (
              <div
                key={offset}
                className="h-[16px] pr-1 text-right text-[length:var(--text-micro)] leading-none text-[var(--text-muted)]"
              >
                {clock.endsWith(":00") ? clock : ""}
              </div>
            );
          })}
        </div>
        {columns.map((col) => (
          <div key={col.day} className="flex min-w-[8rem] flex-1 flex-col">
            <div className="flex h-10 items-center justify-center px-1 text-center text-[length:var(--text-micro)] leading-tight text-[var(--text-muted)]">
              {col.label}
            </div>
            <div className="relative w-full" style={{ height: gridHeight }}>
              {rows.map((offset) => (
                <div
                  key={offset}
                  className="h-[16px] border-l border-t border-l-[var(--surface-sunken)] border-t-[var(--surface-sunken)]"
                />
              ))}
              {col.blocks.map((b) => {
                const top = Math.max(0, b.startOffset - fromOffset) * PX_PER_MINUTE;
                const bottom = Math.min(toOffset, b.endOffset) - fromOffset;
                const height = Math.max(ROW_H_PX, bottom * PX_PER_MINUTE - top);
                return (
                  <div
                    key={b.key}
                    style={{
                      top,
                      height,
                      left: `calc(${(b.lane / b.lanes) * 100}% + 1px)`,
                      width: `calc(${100 / b.lanes}% - 2px)`,
                    }}
                    className={`absolute overflow-hidden rounded-[var(--radius-sm)] border ${TONE[b.tone]}`}
                  >
                    {b.content}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
