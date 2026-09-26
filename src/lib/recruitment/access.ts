import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { community, cycle, member, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "../errors";
import { isModuleOpenToEveryone, listGrantingTaskIds } from "../permissions";

type Member = typeof memberTable.$inferSelect;

export async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// "Whoever currently holds it is 'a recruitment-facing task' holder
// throughout this whole batch (Phases 32-35), not a dedicated role" —
// same access-follows-the-task pattern Event scheduling's
// isEventSchedulingOwner / Budget's isBudgetOwner already establish.
//
// An open module answers true for every member. This is the resolver that
// actually makes a decision reachable: `recruitmentEvaluatorCount` defaults
// to 2, `recruitment` is single-cardinality per scope, and
// computeRecruitmentOutcome refuses to evaluate below the threshold — so a
// Community with one holder can never satisfy any rule above the mandatory
// fallback and every application parks at decision_pending forever
// (docs/recruitment-access-plan.md §1). Opening Recruitment is the fix;
// listHeldRecruitmentScopes below then supplies the scope, and the two
// together are what a non-holder needs to evaluate.
export async function isRecruitmentTaskHolder(actor: Member) {
  if (await isModuleOpenToEveryone(actor.communityId, "recruitment")) {
    return true;
  }

  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "recruitment");
  if (grantingTaskIds.length === 0) return false;

  const [holding] = await db
    .select({ id: task.id })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        inArray(task.id, grantingTaskIds),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return Boolean(holding);
}

export async function requireRecruitmentTaskHolder(actor: Member) {
  if (!(await isRecruitmentTaskHolder(actor))) {
    throw new ForbiddenError("Only a current recruitment-task holder can do this");
  }
}

// "Who could actually be doing Recruitment right now, and by what
// authority?" — the question the /recruitment hub has to answer *before*
// it shows anyone a pipeline.
//
// This exists because task-gating Recruitment has a failure mode nothing
// else in the module surfaces: `listGrantingTaskIds` returning empty makes
// `isRecruitmentTaskHolder` false for *everyone, permanently* (see the
// early return in isRecruitmentTaskHolder above), and a grant whose task
// nobody currently holds is the same shape of stuck. In both cases the old
// /recruitment page rendered "only a current recruitment-task holder can
// see this view" — true, useless, and addressed to the one person (an
// Admins holder) who could actually fix it. So the hub needs the
// *authority* state, not just the actor's own boolean.
//
// Deliberately community-scoped rather than actor-scoped, and unauthenticated
// beyond the caller's membership: it is a status read, not a capability. It
// discloses *whether* recruitment is staffed and *which task* staffs it —
// both already visible on the task page to any member — and never any
// application content. Member names are included for the holder/admin
// states, which the hub shows to whoever can act on it; a plain member gets
// the counts and the task titles only (see RecruitmentHub).
export type RecruitmentGrantRow = {
  taskId: string;
  taskTitle: string;
  cycleId: string | null;
  cycleName: string | null;
};

export type RecruitmentHolderRow = RecruitmentGrantRow & {
  memberId: string;
  memberName: string;
};

export type RecruitmentAuthority = {
  // The Community has declared Recruitment open to all its members. A fourth
  // authority state alongside granted/held/unheld — without it the hub tells
  // an open Community "No task grants Recruitment, so nobody can evaluate
  // applications", which is exactly the self-contradiction the hub was built
  // to end.
  open: boolean;
  grants: RecruitmentGrantRow[];
  holders: RecruitmentHolderRow[];
  // Distinct people who can file an evaluation right now. NOT a count of
  // grants: two grants held by the same person are one evaluator, and
  // computeRecruitmentOutcome counts distinct `evaluation.evaluatorId` rows
  // against community.recruitmentEvaluatorCount, so this is the number that
  // has to be compared with it to know whether a decision is reachable. It is
  // *not* the member count when `open` — an open module has unbounded
  // evaluators, which is precisely what makes the count reachable.
  evaluatorCount: number;
  // True when the Community is neither granted nor open, or is granted with
  // nobody holding — i.e. nobody can evaluate *and* nobody can be asked to.
  // Kept separate from `open` so the hub can tell "unreachable" from
  // "unlimited".
  unstaffed: boolean;
  // True when applications can be decided but the two side-effects that
  // follow a decision cannot be filed: createIntroCallPoll and
  // maybeCreateAccompanimentTask both take their branchId from the granting
  // task, and there is no member-scoped or cycle-scoped branch to fall back
  // on (a member has no branch column). So with an open module and no
  // granting task, the decision is recorded but no intro call is scheduled
  // and no accompaniment task is created. The hub surfaces this rather than
  // inventing an arbitrary branch to file under — a real Poll and a real Task
  // appearing under an unrelated branch is worse than a visible gap.
  needsTaskToFileUnder: boolean;
};

export async function describeRecruitmentAuthority(communityId: string): Promise<RecruitmentAuthority> {
  const open = await isModuleOpenToEveryone(communityId, "recruitment");
  const grantingTaskIds = await listGrantingTaskIds(communityId, "recruitment");
  if (grantingTaskIds.length === 0) {
    return {
      open,
      grants: [],
      holders: [],
      evaluatorCount: open ? Number.POSITIVE_INFINITY : 0,
      unstaffed: !open,
      needsTaskToFileUnder: open,
    };
  }

  const grantRows = await db
    .select({
      taskId: task.id,
      taskTitle: task.title,
      cycleId: task.cycleId,
      cycleName: cycle.name,
    })
    .from(task)
    .leftJoin(cycle, eq(cycle.id, task.cycleId))
    .where(inArray(task.id, grantingTaskIds));

  // `isShadow: false` is the same filter isRecruitmentTaskHolder applies —
  // a shadow assignment is a placeholder, not someone doing the work, so
  // counting one as an evaluator would overstate capacity and make a
  // permanently-unreachable decision look reachable.
  const holderRows = await db
    .select({
      taskId: task.id,
      taskTitle: task.title,
      cycleId: task.cycleId,
      cycleName: cycle.name,
      memberId: member.id,
      memberName: member.name,
    })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .innerJoin(member, eq(member.id, taskAssignment.memberId))
    .leftJoin(cycle, eq(cycle.id, task.cycleId))
    .where(and(inArray(task.id, grantingTaskIds), eq(taskAssignment.isShadow, false)));

  return {
    open,
    grants: grantRows,
    holders: holderRows,
    // Unbounded when open: the count is only meaningful for the
    // task-gated case, and an open module trivially satisfies any
    // recruitmentEvaluatorCount.
    evaluatorCount: open ? Number.POSITIVE_INFINITY : new Set(holderRows.map((h) => h.memberId)).size,
    // Open and staffed is the healthy state; open and unheld is not, because
    // the decision side-effects still need a task to file under.
    unstaffed: holderRows.length === 0 && !open,
    needsTaskToFileUnder: false,
  };
}

// The set of scopes the actor currently holds recruitment for — the
// placement cycleIds (`task.cycleId`) of the recruitment-granted tasks
// they hold. A `null` member of the set means they hold a cycle-less
// (community/evergreen) recruitment task, which covers every application
// — cycle-tagged or not — mirroring feedback_review's resolver and the
// two Phase 68 modules (docs/cycle-scope-remediation-plan.md §4.3).
//
// An open module answers `{null}` — the community/evergreen scope, which is
// already the superset under §4.3's strictness rule, so every downstream
// `heldScopes.has(null)` / `has(cycleId)` check passes without this function
// knowing anything about events. That is also what lets an open Recruitment
// Community reach a decision at all: `recruitmentEvaluatorCount` defaults to
// 2 while `recruitment` is single-cardinality per scope, so with one holder
// no decision rule above the fallback can ever match
// (docs/recruitment-access-plan.md §1).
export async function listHeldRecruitmentScopes(actor: Member): Promise<Set<string | null>> {
  if (await isModuleOpenToEveryone(actor.communityId, "recruitment")) {
    return new Set([null]);
  }

  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "recruitment");
  if (grantingTaskIds.length === 0) return new Set();

  const rows = await db
    .select({ cycleId: task.cycleId })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        inArray(task.id, grantingTaskIds),
        eq(task.communityId, actor.communityId),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return new Set(rows.map((r) => r.cycleId));
}

// The write-side companion to listHeldRecruitmentScopes: "may this
// member act on an application that sits in (or, untagged, outside) a
// given cycle?" The community/evergreen scope (null) covers everything —
// untagged applications and every cycle's alike — while a cycle-placed
// holder covers only their own cycle's applications, §4.3's strictness
// rule (D1: no fallback between scopes).
export async function requireRecruitmentScopeForCycle(actor: Member, cycleId: string | null) {
  const heldScopes = await listHeldRecruitmentScopes(actor);
  if (heldScopes.size === 0) {
    throw new ForbiddenError("Only a current recruitment-task holder can do this");
  }
  if (!heldScopes.has(null) && !heldScopes.has(cycleId)) {
    throw new ForbiddenError("You don't hold the recruitment task for this application's event");
  }
}
