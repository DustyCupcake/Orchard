import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { community, member, task, taskAssignment, viewAsLog } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { getCurrentSession, setViewAsOverlay } from "./session";
import { ForbiddenError, NotFoundError } from "./errors";

type Member = typeof memberTable.$inferSelect;

// Same "claimable like any other task, current holders are the pool"
// pattern as isCoordinationHolder/isAdmin (Phases 15/13) — see
// docs/spec.md's "View-as (support)". Shadows don't count, same as
// everywhere else this pattern is used.
export async function isSupportHolder(actor: Member) {
  const [communityRow] = await db.select().from(community).where(eq(community.id, actor.communityId));
  if (!communityRow) return false;

  const holdings = await db
    .select({ tags: task.tags })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
        eq(task.communityId, actor.communityId),
      ),
    );

  return holdings.some((h) => h.tags.includes(communityRow.supportTag));
}

export async function requireSupportHolder(actor: Member) {
  if (!(await isSupportHolder(actor))) {
    throw new ForbiddenError("Only a current Support-task holder can do this");
  }
}

export interface ViewAsState {
  realMember: Member;
  viewedMember: Member;
}

// The single source of truth for "is View-as currently active for this
// browser session, and who as." Re-verifies the real member still
// holds a Support task on every call — access follows the task, so
// losing it silently ends View-as the next time this is checked, the
// same "lose the task, lose the access" rule this codebase enforces
// everywhere else, deliberately used here instead of a separate expiry
// timer. Also closes out the log row when it clears an overlay this
// way, so the audit trail doesn't show a session as "still active"
// after the capability that justified it is gone.
export async function getActiveViewAs(): Promise<ViewAsState | null> {
  const session = await getCurrentSession();
  if (!session?.session.viewingAsMemberId) return null;

  const realMember = session.member;
  const targetMemberId = session.session.viewingAsMemberId;

  if (!(await isSupportHolder(realMember))) {
    await clearOverlay(realMember.id, targetMemberId);
    return null;
  }

  const [target] = await db.select().from(member).where(eq(member.id, targetMemberId));
  if (!target || target.communityId !== realMember.communityId) {
    await clearOverlay(realMember.id, targetMemberId);
    return null;
  }

  return { realMember, viewedMember: target };
}

async function clearOverlay(activatedBy: string, targetMemberId: string) {
  await setViewAsOverlay(null);
  await db
    .update(viewAsLog)
    .set({ endedAt: new Date() })
    .where(
      and(
        eq(viewAsLog.activatedBy, activatedBy),
        eq(viewAsLog.targetMemberId, targetMemberId),
        isNull(viewAsLog.endedAt),
      ),
    );
}

// The one function a page calls instead of getCurrentMember() when it
// wants View-as-aware rendering: `real` is the actual logged-in
// identity (redirect-to-login checks, the persistent banner, gating
// writes — never spoofed), `viewing` is what every existing
// actor-scoped read/list function should be called with — the target
// member's own row during an active View-as session, so pages render
// exactly what that member would see with no changes to the read
// functions themselves. `viewAs` is null outside a View-as session.
export async function getViewingContext() {
  const session = await getCurrentSession();
  if (!session) {
    return { real: null as Member | null, viewing: null as Member | null, viewAs: null as ViewAsState | null };
  }

  const viewAs = await getActiveViewAs();
  return {
    real: session.member,
    viewing: viewAs?.viewedMember ?? session.member,
    viewAs,
  };
}

// Server Actions call this alongside their usual actor resolution (see
// every `src/app/(app)/**/actions.ts`'s own requireMember() wrapper),
// so a write can never go through while the session is rendering as
// someone else — "disabled at the UI layer" (AppShell.tsx dims/blocks
// every rendered write form once View-as is active) "and re-checked/
// rejected server-side regardless" (this), per
// docs/development-plan.md's Phase 54 Done-when.
//
// Deliberately NOT wired into src/lib/api.ts's requireMember() — that
// function is shared by ~150 REST routes' GET *and* write handlers
// alike, and by the one client component that reads through it
// (Scheduling polls' AvailabilityGrid, over `/api/scheduling-polls/
// [id]/availability`'s GET). Guarding it there would also break
// legitimate REST *reads* made through the same session while View-as
// happens to be on — a real regression, since the REST surface is a
// separate, non-page-rendering access path this codebase already
// treats independently everywhere else (curl-driven testing, this
// grid's own client fetches). View-as governs page-rendered, Server-
// Action-driven mutations; REST always operates as the real
// authenticated member, unaffected — except that one route's POST
// handler, a dedicated write-only endpoint with no shared read traffic
// to protect, which calls this directly since nothing else could catch
// a write coming from that one client-JS exception.
export async function assertNotViewingAs() {
  if (await getActiveViewAs()) {
    throw new ForbiddenError("Writes are disabled while viewing as another member");
  }
}

// Support-task-holder-only: switch this browser session to render as
// targetMemberId. Logged immediately, the same accountability-trail
// pattern Emergency access (Phase 46) established.
export async function activateViewAs(actor: Member, targetMemberId: string) {
  await requireSupportHolder(actor);

  if (targetMemberId === actor.id) {
    throw new ForbiddenError("Already viewing as yourself");
  }

  const [target] = await db.select().from(member).where(eq(member.id, targetMemberId));
  if (!target || target.communityId !== actor.communityId) {
    throw new NotFoundError("Member not found in your community");
  }

  const [log] = await db
    .insert(viewAsLog)
    .values({ activatedBy: actor.id, targetMemberId })
    .returning();
  await setViewAsOverlay(targetMemberId);

  return { log, target };
}

// Ends the current session's View-as overlay, if any — a no-op if
// nothing's active (e.g. a stale "End View-as" resubmit).
export async function deactivateViewAs(actor: Member) {
  const viewAs = await getActiveViewAs();
  if (!viewAs) return null;

  await setViewAsOverlay(null);

  const [log] = await db
    .update(viewAsLog)
    .set({ endedAt: new Date() })
    .where(
      and(
        eq(viewAsLog.activatedBy, actor.id),
        eq(viewAsLog.targetMemberId, viewAs.viewedMember.id),
        isNull(viewAsLog.endedAt),
      ),
    )
    .returning();

  return log ?? null;
}
