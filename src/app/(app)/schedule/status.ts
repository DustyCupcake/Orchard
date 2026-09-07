import type { Tone } from "@/components/ui/kit";

// Split out of page.tsx — Next.js's page-export validator rejects any
// named export from a page.tsx beyond its own recognized set
// (default, generateMetadata, dynamic, ...), so a plain const shared
// with EventReviewSection.tsx has to live in its own module instead.
export const STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed",
  conflict: "Conflict — needs a different slot or the owner's mediation",
  confirmed: "Confirmed",
  declined: "Declined",
};

// Mirrors tasks/[id]'s NOMINATION_STATUS_TONE ("pending"→warning,
// "accepted"→success, "declined"→danger) applied to this module's own
// proposed/conflict/confirmed/declined enum.
export const STATUS_TONE: Record<string, Tone> = {
  proposed: "warning",
  conflict: "danger",
  confirmed: "success",
  declined: "danger",
};
