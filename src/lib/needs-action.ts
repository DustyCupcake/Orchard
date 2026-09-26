import { listHoldersOfTasks, listGrantingTaskIds, isModuleOpenToEveryone } from "./permissions";
import type { PermissionModuleKey } from "./permissions";

// Every "something needs doing here" list in the app is a **personal
// obligation** by construction: its gate is "you hold the thing that has to
// be done", and its copy is written in the second person ("Budget needs
// *your* attention", "Shift occurrences needing *completion marks*"). The
// Dashboard renders six of them as sections and the nav badge sums their
// lengths (src/lib/dashboard.ts, src/lib/nav.ts).
//
// An open module breaks that assumption. `isBudgetOwner` and its five
// siblings now answer true for every member, so an open Community's
// outstanding work appears in *every* member's feed and multiplies the badge
// for everyone — items nobody opted into, phrased as though each were their
// own.
//
// So each list splits its output. `personal` is what the member is on the
// hook for; `shared` is outstanding for the Community because the module is
// open. The distinction is **consent, not headcount**
// (docs/open-permissions-plan.md §3.2): a task with `capacity: 3` is a
// deliberate redundancy choice, so its three holders each get a *personal*
// item, while an open-and-unheld module's members get a *shared* one.
//
// The Dashboard shows personal sections first and shared ones below and
// marked; the nav badge counts `personal` only, since the badge is defined
// as "your held-task obligations" (src/lib/nav.ts).
export type NeedsAction<T> = {
  personal: T[];
  shared: T[];
};

export function emptyNeedsAction<T>(): NeedsAction<T> {
  return { personal: [], shared: [] };
}

// Is this member in `moduleKey` *only* because the module is open — i.e.
// would they have no business seeing these items at all if it weren't?
//
// `grantingTaskIds` is passed in rather than looked up because every caller
// already has the module's granting tasks in hand (or is one join away), and
// the scope a list cares about is its own business — the budget's cycleId, a
// shift series' cycleId, and so on. Re-deriving them here would mean
// re-deciding scope in a second place, which is the mistake
// `listGrantingTaskIdsForScope` already gets one caller to make correctly.
//
// Used only for the split, never for authorization: by the time this is
// called, the list's own gate has already passed.
export async function isSharedByOpenness(
  communityId: string,
  moduleKey: PermissionModuleKey,
  actorId: string,
  grantingTaskIds: readonly string[],
): Promise<boolean> {
  if (!(await isModuleOpenToEveryone(communityId, moduleKey))) return false;
  if (grantingTaskIds.length === 0) return true;
  const holders = await listHoldersOfTasks(grantingTaskIds);
  return !holders.some((h) => h.memberId === actorId);
}

// The community-wide id-list, for the one module that is `community`-tier
// and so has no cycle to scope by (conflict_team). Split out so the callsite
// reads the same as the scoped ones.
export async function grantingTaskIdsFor(communityId: string, moduleKey: PermissionModuleKey) {
  return listGrantingTaskIds(communityId, moduleKey);
}
