import type { assembly as assemblyTable } from "@/db/schema";

type Assembly = typeof assemblyTable.$inferSelect;

export type AssemblyPhase = "agenda" | "notice" | "voting" | "closed";

// Always computed, never stored — see src/db/schema/assembly.ts's
// schema comment.
export function computeAssemblyPhase(a: Assembly, now: Date = new Date()): AssemblyPhase {
  if (now < a.agendaEndsAt) return "agenda";
  if (now < a.noticeEndsAt) return "notice";
  if (now < a.votingEndsAt) return "voting";
  return "closed";
}
