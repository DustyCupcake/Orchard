import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community } from "@/db/schema";
import { ConflictError } from "./errors";

// docs/spec.md's "Physical/on-site mode" — see docs/development-plan.md's
// Phase 47. Community.onsiteModeEnabled has sat unused in the schema
// since Phase 1; this is the first thing that ever reads it.
//
// Shift-lock: while on, structural/configuration changes reject with a
// real, visible error — "reshaping what work exists," not "doing the
// work," which stays fully live throughout (task claim/release/finish,
// wiki/comments/resources, Shift sign-up/withdraw/completion,
// coordination mechanics, Task milestones, Freestanding events — none
// of that goes through either of these).
const LOCK_MESSAGE =
  "On-site mode is on — structural changes are locked until it's turned off from Settings.";

export function requireNotOnsiteLocked(communityRow: { onsiteModeEnabled: boolean }) {
  if (communityRow.onsiteModeEnabled) {
    throw new ConflictError(LOCK_MESSAGE);
  }
}

// For a call site with no community row already in hand — most of the
// affected surfaces (Zone/Placement edits) already fetch one for their
// own holder check and should pass it to requireNotOnsiteLocked
// directly instead, to avoid a second query.
export async function requireNotOnsiteLockedForCommunity(communityId: string) {
  const [row] = await db
    .select({ onsiteModeEnabled: community.onsiteModeEnabled })
    .from(community)
    .where(eq(community.id, communityId));
  requireNotOnsiteLocked(row ?? { onsiteModeEnabled: false });
}
