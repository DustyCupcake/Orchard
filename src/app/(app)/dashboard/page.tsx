import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getCommunitySnapshot, getPersonalFeed } from "@/lib/dashboard";
import { ATTENTION_STYLES } from "@/lib/format";

export const dynamic = "force-dynamic";

const HEALTH_STYLES: Record<string, { label: string; color: string }> = {
  on_track: { label: "on track", color: "#2a7a2a" },
  attention_needed: { label: "attention needed", color: "#a15c00" },
  struggling: { label: "struggling", color: "#b3001b" },
};

export default async function DashboardPage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const [feed, snapshot] = await Promise.all([
    getPersonalFeed(currentMember),
    getCommunitySnapshot(currentMember),
  ]);

  const hasFeedItems =
    feed.pendingJoinRequests.length > 0 ||
    feed.upcomingCheckins.length > 0 ||
    feed.flaggedHeldTasks.length > 0 ||
    feed.recruitmentNeedsAction.length > 0 ||
    feed.placementInvites.length > 0 ||
    feed.myLinkedPendingPlacements.length > 0 ||
    feed.placementRevertNotices.length > 0 ||
    feed.placementPendingReviews.length > 0 ||
    feed.calendarEventInvites.length > 0;
  const now = Date.now();

  const NEEDS_ACTION_LABEL: Record<string, string> = {
    call_pending: "evaluated, call not scheduled yet",
    decision_pending: "call happened, decision still pending",
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
