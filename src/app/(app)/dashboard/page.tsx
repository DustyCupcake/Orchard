import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { getCommunitySnapshot, getPersonalFeed } from "@/lib/dashboard";
import { ATTENTION_STYLES } from "@/lib/format";
import { respondToNominationAction } from "./actions";

export const dynamic = "force-dynamic";

const HEALTH_STYLES: Record<string, { label: string; color: string }> = {
  on_track: { label: "on track", color: "#2a7a2a" },
  attention_needed: { label: "attention needed", color: "#a15c00" },
  struggling: { label: "struggling", color: "#b3001b" },
};

export default async function DashboardPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const [feed, snapshot] = await Promise.all([
    getPersonalFeed(viewing),
    getCommunitySnapshot(viewing),
  ]);

  const hasFeedItems =
    feed.pendingJoinRequests.length > 0 ||
    feed.upcomingCheckins.length > 0 ||
    feed.flaggedHeldTasks.length > 0 ||
    feed.emergencyAccessActivity.length > 0 ||
    feed.recruitmentNeedsAction.length > 0 ||
    feed.placementInvites.length > 0 ||
    feed.myLinkedPendingPlacements.length > 0 ||
    feed.placementRevertNotices.length > 0 ||
    feed.placementPendingReviews.length > 0 ||
    feed.calendarEventInvites.length > 0 ||
    feed.budgetNeedsAction.length > 0 ||
    feed.eventSchedulingNeedsAction.length > 0 ||
    feed.shiftCoordinatorNeedsAction.length > 0 ||
    feed.myShiftsNeedingCompletion.length > 0 ||
    feed.conflictNeedsAction.length > 0 ||
    feed.pendingNominations.length > 0 ||
    feed.expiredNominations.length > 0;
  const now = Date.now();

  const NEEDS_ACTION_LABEL: Record<string, string> = {
    call_pending: "evaluated, call not scheduled yet",
    decision_pending: "call happened, decision still pending",
  };

  const BUDGET_LABEL: Record<string, string> = {
    close_to_voting: "proposal deadline passed — close to voting",
    confirm_funded_set: "voting is in, confirm the funded set",
    cast_vote: "voting is open — cast your vote",
  };

  const EVENT_STATUS_LABEL: Record<string, string> = {
    conflict: "flagged conflicting",
    proposed: "awaiting your review",
  };

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 720 }}>
      <h1>Dashboard</h1>

      <section style={{ marginTop: "1rem" }}>
        <h2>What&rsquo;s next for you</h2>

        {!hasFeedItems && (
          <p style={{ color: "#666" }}>
            Nothing pending on what you&rsquo;re holding right now. <Link href="/board">Browse the board</Link>{" "}
            for something to work on.
          </p>
        )}

        {feed.pendingNominations.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Tasks someone thinks fit you</h3>
            <p style={{ fontSize: "0.8rem", color: "#666", margin: "0 0 0.4rem" }}>
              You&rsquo;re already holding these — a yes, no, or not-now are all fine. No response
              by the deadline releases it back automatically.
            </p>
            {feed.pendingNominations.map(({ nomination, taskTitle, nominatorName }) => (
              <div key={nomination.id} style={{ marginBottom: "0.5rem" }}>
                <p style={{ margin: 0 }}>
                  <Link href={`/tasks/${nomination.taskId}`} style={{ color: "inherit" }}>
                    {taskTitle}
                  </Link>{" "}
                  <span style={{ color: "#666" }}>
                    — {nominatorName} thinks this is a fit, respond by{" "}
                    {new Date(nomination.respondByDeadline).toLocaleString()}
                    {nomination.message && <>: &ldquo;{nomination.message}&rdquo;</>}
                  </span>
                </p>
                <form
                  action={respondToNominationAction}
                  style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}
                >
                  <input type="hidden" name="nominationId" value={nomination.id} />
                  <button type="submit" name="response" value="accepted">
                    Accept
                  </button>
                  <button type="submit" name="response" value="declined">
                    Not for me
                  </button>
                  <button type="submit" name="response" value="not_now">
                    Not right now
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}

        {feed.expiredNominations.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Nominations that went unanswered</h3>
            <ul>
              {feed.expiredNominations.map(({ nomination, taskTitle, nomineeName }) => (
                <li key={nomination.id}>
                  <Link href={`/tasks/${nomination.taskId}`} style={{ color: "inherit" }}>
                    {taskTitle}
                  </Link>{" "}
                  <span style={{ color: "#666" }}>
                    — {nomineeName} didn&rsquo;t respond, released back to Unclaimed
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feed.pendingJoinRequests.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Join requests waiting on you</h3>
            <ul>
              {feed.pendingJoinRequests.map((r) => (
                <li key={r.id}>
                  <Link href={`/tasks/${r.taskId}`} style={{ color: "inherit" }}>
                    {r.taskTitle}
                  </Link>{" "}
                  <span style={{ color: "#666" }}>
                    — {r.requestedByName} asked to join, {new Date(r.requestedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feed.emergencyAccessActivity.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Emergency access activity</h3>
            <ul>
              {feed.emergencyAccessActivity.map((a) => (
                <li key={a.id}>
                  <Link href={`/members/${a.role === "activator" ? a.targetMemberId : a.activatedBy}`} style={{ color: "inherit" }}>
                    {a.counterpartName}
                  </Link>{" "}
                  <span style={{ color: "#666" }}>
                    — {a.role === "activator" ? "you activated on them" : "activated on you"},{" "}
                    {new Date(a.activatedAt).toLocaleString()}
                    {a.explanation ? `: "${a.explanation}"` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feed.upcomingCheckins.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Check-ins</h3>
            <ul>
              {feed.upcomingCheckins.map((t) => {
                const overdue = t.nextCheckinAt.getTime() < now;
                return (
                  <li key={t.id}>
                    <Link href={`/tasks/${t.id}`} style={{ color: "inherit" }}>
                      {t.title}
                    </Link>{" "}
                    <span style={{ color: overdue ? "crimson" : "#666" }}>
                      — {overdue ? "was due" : "due"} {new Date(t.nextCheckinAt).toLocaleDateString()}
                      {overdue ? " (overdue)" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {feed.flaggedHeldTasks.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Flagged tasks you hold</h3>
            <ul>
              {feed.flaggedHeldTasks.map((t) => (
                <li key={t.id}>
                  <Link href={`/tasks/${t.id}`} style={{ color: "inherit" }}>
                    {t.title}
                  </Link>{" "}
                  <span style={{ color: "#666" }}>({t.branchName})</span>{" "}
                  {ATTENTION_STYLES[t.attentionLevel] && (
                    <span style={{ color: ATTENTION_STYLES[t.attentionLevel].color, fontWeight: 600 }}>
                      ⚠ {ATTENTION_STYLES[t.attentionLevel].label}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {feed.recruitmentNeedsAction.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Recruitment candidates stuck waiting on you</h3>
            <ul>
              {feed.recruitmentNeedsAction.map((c) => (
                <li key={c.id}>
                  <Link href="/recruitment" style={{ color: "inherit" }}>
                    Application from {new Date(c.submittedAt).toLocaleDateString()}
                  </Link>{" "}
                  <span style={{ color: "#a15c00", fontWeight: 600 }}>
                    — {NEEDS_ACTION_LABEL[c.stage] ?? c.stage}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feed.placementInvites.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Spatial planning invites waiting on you</h3>
            <ul>
              {feed.placementInvites.map((i) => (
                <li key={i.placementId}>
                  <Link href="/spatial-planning" style={{ color: "inherit" }}>
                    {i.placementLabel}
                  </Link>{" "}
                  <span style={{ color: "#666" }}>
                    — invited by {i.invitedByName}, {new Date(i.invitedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feed.myLinkedPendingPlacements.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Placements you&rsquo;re linked to, pending review</h3>
            <ul>
              {feed.myLinkedPendingPlacements.map((p) => (
                <li key={p.id}>
                  <Link href="/spatial-planning" style={{ color: "inherit" }}>
                    {p.label}
                  </Link>{" "}
                  <span style={{ color: "#a15c00" }}>— pending the holder&rsquo;s review</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feed.placementRevertNotices.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Placement edits reverted</h3>
            <ul>
              {feed.placementRevertNotices.map((n) => (
                <li key={n.notice.id}>
                  <Link href="/spatial-planning" style={{ color: "inherit" }}>
                    {n.placementLabel}
                  </Link>{" "}
                  <span style={{ color: "#666" }}>
                    — reverted by {n.revertedByName}
                    {n.notice.note ? `: “${n.notice.note}”` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feed.placementPendingReviews.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Placement changes awaiting your review</h3>
            <ul>
              {feed.placementPendingReviews.map((r) => (
                <li key={r.placement.id}>
                  <Link href="/spatial-planning" style={{ color: "inherit" }}>
                    {r.placement.label}
                  </Link>{" "}
                  <span style={{ color: "#666" }}>— moved by {r.movedByName}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feed.budgetNeedsAction.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Budget needs your attention</h3>
            <ul>
              {feed.budgetNeedsAction.map((b, i) => (
                <li key={`${b.cycleId}-${b.kind}-${i}`}>
                  <Link href="/budget" style={{ color: "inherit" }}>
                    {b.cycleTitle}
                  </Link>{" "}
                  <span style={{ color: "#a15c00", fontWeight: 600 }}>
                    — {BUDGET_LABEL[b.kind] ?? b.kind}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feed.eventSchedulingNeedsAction.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Event proposals awaiting review</h3>
            <ul>
              {feed.eventSchedulingNeedsAction.map((p) => (
                <li key={p.proposalId}>
                  <Link href="/schedule" style={{ color: "inherit" }}>
                    {p.title}
                  </Link>{" "}
                  <span style={{ color: p.status === "conflict" ? "#b3001b" : "#a15c00", fontWeight: 600 }}>
                    — {EVENT_STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feed.shiftCoordinatorNeedsAction.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Shift occurrences needing completion marks</h3>
            <ul>
              {feed.shiftCoordinatorNeedsAction.map((o) => (
                <li key={o.occurrenceId}>
                  <Link href="/shifts" style={{ color: "inherit" }}>
                    {o.seriesTitle}
                  </Link>{" "}
                  <span style={{ color: "#666" }}>
                    — {new Date(o.startsAt).toLocaleDateString()},{" "}
                    {o.unresolvedCount} signup{o.unresolvedCount === 1 ? "" : "s"} still unresolved
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feed.myShiftsNeedingCompletion.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Your own past shifts</h3>
            <ul>
              {feed.myShiftsNeedingCompletion.map((s) => (
                <li key={s.signupId}>
                  <Link href="/shifts" style={{ color: "inherit" }}>
                    {s.seriesTitle}
                  </Link>{" "}
                  <span style={{ color: "#666" }}>
                    — ended {new Date(s.endsAt).toLocaleDateString()}, mark it complete
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feed.conflictNeedsAction.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Conflict reports needing acknowledgment</h3>
            <ul>
              {feed.conflictNeedsAction.map((r) => (
                <li key={r.reportId}>
                  <Link href="/conflict-reports" style={{ color: "inherit" }}>
                    Report from {new Date(r.createdAt).toLocaleDateString()}
                  </Link>{" "}
                  <span style={{ color: "#b3001b", fontWeight: 600 }}>— past the acknowledgment window</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feed.calendarEventInvites.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Event invites waiting on you</h3>
            <ul>
              {feed.calendarEventInvites.map((i) => (
                <li key={i.eventId}>
                  <Link href="/calendar" style={{ color: "inherit" }}>
                    {i.eventTitle}
                  </Link>{" "}
                  <span style={{ color: "#666" }}>
                    — invited by {i.invitedByName}, {new Date(i.invitedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <hr style={{ margin: "2rem 0" }} />

      <section>
        <h2>Community snapshot</h2>
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          Aggregate only — nothing here is broken out by individual. See{" "}
          <Link href="/contribution">your own contribution picture</Link> for what you&rsquo;ve
          done, or opt in to share it.
        </p>

        {snapshot.activeMemberCount !== null && (
          <p>
            <strong>{snapshot.activeMemberCount}</strong> member{snapshot.activeMemberCount === 1 ? "" : "s"}{" "}
            coming this cycle
          </p>
        )}

        {snapshot.tierCounts.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Tiers</h3>
            <ul>
              {snapshot.tierCounts.map((t) => (
                <li key={t.id}>
                  {t.name}: {t.count} member{t.count === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          </div>
        )}

        {snapshot.branchSpread.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <h3>Branch spread</h3>
            <ul>
              {snapshot.branchSpread.map((b) => (
                <li key={b.id}>
                  {b.name}: {b.memberCount} member{b.memberCount === 1 ? "" : "s"} currently holding a
                  task
                </li>
              ))}
            </ul>
          </div>
        )}

        {snapshot.branchHealth.length > 0 && (
          <div>
            <h3>Branch health</h3>
            <ul>
              {snapshot.branchHealth.map((b) => (
                <li key={b.id}>
                  {b.name}:{" "}
                  <span style={{ color: HEALTH_STYLES[b.status].color, fontWeight: 600 }}>
                    {HEALTH_STYLES[b.status].label}
                  </span>
                  {b.counts && (
                    <span style={{ color: "#666", fontSize: "0.85rem" }}>
                      {" "}
                      — {b.counts.soft} soft · {b.counts.hard} hard · {b.counts.escalated} escalated
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
