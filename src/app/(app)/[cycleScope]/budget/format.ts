import { lineItemTotal } from "@/lib/budget";
import type { BudgetLineItem } from "@/lib/budget";

export function formatAmount(n: number) {
  return n.toLocaleString();
}

// "8 × 50 = 400" / "23 attendees × 10 = 230" — the per-line breakdown
// shown next to a multiplied item so the total isn't a mystery. A
// plain (non-multiplied) item just shows its amount.
export function formatLineItemDetail(item: BudgetLineItem, attendeeCount: number | null) {
  const total = lineItemTotal(item, attendeeCount);
  if (item.perAttendee) {
    return attendeeCount === null
      ? `${formatAmount(item.amount)} per attendee — no event linked, so this counts as ${formatAmount(0)} for now`
      : `${attendeeCount} attendee${attendeeCount === 1 ? "" : "s"} × ${formatAmount(item.amount)} = ${formatAmount(total)}`;
  }
  if (item.quantity && item.quantity > 1) {
    return `${item.quantity} × ${formatAmount(item.amount)} = ${formatAmount(total)}`;
  }
  return formatAmount(item.amount);
}

// Rolls fixed costs and every approved proposal's line items up by Branch — a
// line item's own branchId when it has one, else its proposal's branchId, else
// "unassigned" (null). A proposal approved for less than it asked counts for
// that share of each line, so the rollup adds up to what was actually decided.
export function budgetByBranch(
  fixedCosts: BudgetLineItem[],
  approved: { branchId: string | null; lineItems: BudgetLineItem[]; totalAmount: number; approvedAmount: number | null }[],
  attendeeCount: number | null,
): Map<string | null, number> {
  const totals = new Map<string | null, number>();
  const add = (branchId: string | null, amount: number) => totals.set(branchId, (totals.get(branchId) ?? 0) + amount);
  for (const item of fixedCosts) {
    add(item.branchId ?? null, lineItemTotal(item, attendeeCount));
  }
  for (const p of approved) {
    const share = p.totalAmount > 0 && p.approvedAmount !== null ? p.approvedAmount / p.totalAmount : 1;
    for (const item of p.lineItems) {
      add(item.branchId ?? p.branchId ?? null, Math.round(lineItemTotal(item, attendeeCount) * share));
    }
  }
  return totals;
}
