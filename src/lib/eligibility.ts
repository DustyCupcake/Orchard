import type { member as memberTable } from "@/db/schema";

type Member = typeof memberTable.$inferSelect;

// The one bit of eligibility logic simple enough, and used in enough
// places, to live outside any one feature's lib — a task's `tier`
// Requirement and cycle-initiation eligibility (see docs/spec.md:
// "The same typed-predicate mechanism gates cycle initiation, not just
// task claims") both reduce to this same check, just against a
// different Tier id from a different place.
export function memberHasTier(member: Member, tierId: string): boolean {
  return member.tierIds.includes(tierId);
}
