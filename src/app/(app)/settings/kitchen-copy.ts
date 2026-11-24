import { KITCHEN_SIGNALS } from "@/db/schema";

// The wording the Kitchen questions panel and the Modules banner share. It
// lives in one place, and counts from KITCHEN_SIGNALS, because both used to
// hardcode "3" and went wrong the day a fourth signal (diet) was added.

const TOTAL = KITCHEN_SIGNALS.length;

/** "none", "3 of 4" — how many of the kitchen's questions are set up. */
export function kitchenSetUpCount(unwiredCount: number): string {
  const setUp = TOTAL - unwiredCount;
  return setUp <= 0 ? "none" : `${setUp} of ${TOTAL}`;
}

/** The panel's sentence about what is left to do. */
export function kitchenPanelSummary(unwiredCount: number): string {
  if (unwiredCount === 0) {
    return "All of them are set up. The kitchen reads these answers only through each question's own audience and each member's consent.";
  }
  return `${unwiredCount} of ${TOTAL} aren't set up yet. Until they are, the kitchen's dietary view has nothing to show.`;
}

/** How a wired question is answered, in a cook's words — by response type. */
export function answerShapeLabel(responseType: string): string {
  switch (responseType) {
    case "multi_choice":
      return "pick any";
    case "single_choice":
      return "pick one";
    case "text":
      return "written answer";
    default:
      return responseType.replace(/_/g, " ");
  }
}
