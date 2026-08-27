import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import {
  getParentTaskSummary,
  getTask,
  getTaskNotes,
  getUnmetRequirements,
  listCandidacies,
  listJoinRequests,
  listMyEndorsements,
  listRequirements,
  listSubtasks,
  tierNameLookup,
  describeRequirement,
} from "@/lib/tasks";
import { listBranches } from "@/lib/settings";
import { ATTENTION_STYLES, effortSummary } from "@/lib/format";
import Nav from "@/components/Nav";
import {
  acceptJoinRequestAction,
  addCommentAction,
  addResourceAction,
  declineJoinRequestAction,
  editWikiAction,
  endorseCandidacyAction,
  expressCandidacyAction,
  splitSubtaskAction,
  withdrawCandidacyAction,
  withdrawJoinRequestAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { id } = await params;
  const { error } = await searchParams;

  const taskRow = await getTask(currentMember, id);
  const isCommunityEndorsed = taskRow.openness === "community_endorsed";
  const [
    branchRow,
    notes,
    requirements,
    unmetRequirements,
    tierNames,
    subtasks,
    parentTask,
    branches,
    joinRequests,
    candidacies,
  ] = await Promise.all([
    db.select().from(branch).where(eq(branch.id, taskRow.branchId)).then((r) => r[0]),
    getTaskNotes(currentMember, id),
    listRequirements(currentMember, id),
    getUnmetRequirements(db, currentMember, id),
    tierNameLookup(currentMember.communityId),
    listSubtasks(currentMember, id),
    taskRow.parentTaskId ? getParentTaskSummary(currentMember, taskRow.parentTaskId) : null,
    listBranches(currentMember),
    listJoinRequests(currentMember, id),
    isCommunityEndorsed ? listCandidacies(currentMember, id) : [],
  ]);
  const myEndorsements = isCommunityEndorsed
    ? await listMyEndorsements(
        currentMember,
        candidacies.map((c) => c.id),
      )
    : new Set<string>();

  const holdsTask = taskRow.assignments.some((a) => a.memberId === currentMember.id);
  const requestGated = taskRow.openness === "request" || taskRow.openness === "coordination_approved";
  const coordinationHolders = taskRow.assignments.filter((a) => a.isCoordinationSlot);
  const canApproveRequests =
    holdsTask &&
    (taskRow.openness !== "coordination_approved" ||
      coordinationHolders.length === 0 ||
      coordinationHolders.some((a) => a.memberId === currentMember.id));
  const pendingRequests = joinRequests.filter((r) => r.status === "pending");
  const resolvedRequests = joinRequests.filter((r) => r.status !== "pending");
  const myRequest = joinRequests.find((r) => r.memberId === currentMember.id);

  const browseWindowOpen = Boolean(
    taskRow.browsePeriodEnd && taskRow.browsePeriodEnd.getTime() > Date.now(),
  );
  const myCandidacy = candidacies.find((c) => c.memberId === currentMember.id);
  const openCandidacies = candidacies.filter((c) => c.status === "open");
  const resolvedCandidacies = candidacies.filter((c) => c.status !== "open");
  const canExpressCandidacy =
    isCommunityEndorsed && browseWindowOpen && !holdsTask && !myCandidacy;

  const memberIds = [
    ...new Set([
      ...taskRow.assignments.map((a) => a.memberId),
      ...notes.comments.map((c) => c.memberId),
      ...notes.wikiRevisions.map((w) => w.editedBy),
      ...notes.resources.map((r) => r.addedBy),
      ...joinRequests.map((r) => r.memberId),
      ...candidacies.map((c) => c.memberId),
    ]),
  ];
  const members = memberIds.length
    ? await db.select().from(member).where(inArray(member.id, memberIds))
    : [];
  const memberNameById = new Map(members.map((m) => [m.id, m.name]));

  const unmetIds = new Set(unmetRequirements.map((r) => r.id));

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <Nav memberName={currentMember.name} />
      <p>
        <Link href="/board" style={{ color: "inherit" }}>
          ← Back to board
        </Link>
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <h1>
        {taskRow.title}
        {taskRow.critical && <span style={{ color: "crimson" }}> · critical</span>}
        {ATTENTION_STYLES[taskRow.attentionLevel] && (
          <span
            style={{ color: ATTENTION_STYLES[taskRow.attentionLevel].color, fontWeight: 600 }}
          >
            {" "}
            · ⚠ {ATTENTION_STYLES[taskRow.attentionLevel].label}
          </span>
        )}
      </h1>
      <div style={{ fontSize: "0.9rem", color: "#666" }}>
        {branchRow?.name ?? "—"} · {effortSummary(taskRow.effort, taskRow.effortMagnitude)} ·{" "}
        {taskRow.status} · {taskRow.assignments.length}
        {taskRow.capacity !== null ? `/${taskRow.capacity}` : ""} held
      </div>
      {parentTask && (
        <p style={{ fontSize: "0.85rem" }}>
          Part of{" "}
          <Link href={`/tasks/${parentTask.id}`} style={{ color: "inherit" }}>
            {parentTask.title}
          </Link>
        </p>
      )}
      {taskRow.assignments.length > 0 && (
        <p>
          Held by:{" "}
          {taskRow.assignments.map((a) => memberNameById.get(a.memberId) ?? "—").join(", ")}
        </p>
      )}
      {taskRow.description && <p>{taskRow.description}</p>}

      {requirements.length > 0 && (
        <ul style={{ fontSize: "0.85rem" }}>
          {requirements.map((r) => (
            <li key={r.id} style={{ color: unmetIds.has(r.id) ? "crimson" : "#2a7a2a" }}>
              {describeRequirement(r, tierNames)}
              {unmetIds.has(r.id) ? " (not met)" : " (met)"}
            </li>
          ))}
        </ul>
      )}

      {isCommunityEndorsed && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Candidacy</h2>
          <p style={{ fontSize: "0.85rem", color: "#666" }}>
            Needs {taskRow.endorsementThreshold} endorsement
            {taskRow.endorsementThreshold === 1 ? "" : "s"} to confirm · browse window{" "}
            {taskRow.browsePeriodEnd
              ? browseWindowOpen
                ? `closes ${taskRow.browsePeriodEnd.toLocaleString()}`
                : `closed ${taskRow.browsePeriodEnd.toLocaleString()}`
              : "not set"}
          </p>

          {openCandidacies.length === 0 && resolvedCandidacies.length === 0 && (
            <p style={{ color: "#666" }}>Nobody has put themselves forward yet.</p>
          )}

          {openCandidacies.map((c) => (
            <div key={c.id} style={{ marginBottom: "0.5rem" }}>
              <p style={{ margin: 0 }}>
                {memberNameById.get(c.memberId) ?? "—"} — {c.endorsementCount}/
                {taskRow.endorsementThreshold} endorsements
              </p>
              {c.memberId === currentMember.id && (
                <form action={withdrawCandidacyAction} style={{ marginTop: "0.25rem" }}>
                  <input type="hidden" name="taskId" value={taskRow.id} />
                  <input type="hidden" name="candidacyId" value={c.id} />
                  <button type="submit">Withdraw</button>
                </form>
              )}
              {c.memberId !== currentMember.id && myEndorsements.has(c.id) && (
                <span style={{ fontSize: "0.85rem", color: "#666" }}>You&rsquo;ve endorsed this</span>
              )}
              {c.memberId !== currentMember.id && !myEndorsements.has(c.id) && browseWindowOpen && (
                <form action={endorseCandidacyAction} style={{ marginTop: "0.25rem" }}>
                  <input type="hidden" name="taskId" value={taskRow.id} />
                  <input type="hidden" name="candidacyId" value={c.id} />
                  <button type="submit">Endorse</button>
                </form>
              )}
            </div>
          ))}

          {resolvedCandidacies.length > 0 && (
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
                Resolved candidacies ({resolvedCandidacies.length})
              </summary>
              <ul style={{ fontSize: "0.8rem" }}>
                {resolvedCandidacies.map((c) => (
                  <li key={c.id}>
                    {memberNameById.get(c.memberId) ?? "—"} — {c.status} ({c.endorsementCount}/
                    {taskRow.endorsementThreshold})
                  </li>
                ))}
              </ul>
            </details>
          )}

          {canExpressCandidacy && (
            <form action={expressCandidacyAction} style={{ marginTop: "0.75rem" }}>
              <input type="hidden" name="taskId" value={taskRow.id} />
              <button type="submit">Put yourself forward</button>
            </form>
          )}
        </section>
      )}

      {myRequest && myRequest.status === "pending" && (
        <p style={{ fontSize: "0.85rem" }}>
          You&rsquo;ve asked to join this task — pending.
          <form
            action={withdrawJoinRequestAction}
            style={{ display: "inline", marginLeft: "0.5rem" }}
          >
            <input type="hidden" name="taskId" value={taskRow.id} />
            <input type="hidden" name="requestId" value={myRequest.id} />
            <button type="submit">Withdraw</button>
          </form>
        </p>
      )}
      {myRequest && myRequest.status === "declined" && (
        <p style={{ fontSize: "0.85rem" }}>
          Your request to join was declined
          {myRequest.declineReason ? `: ${myRequest.declineReason}` : "."}
        </p>
      )}

      {(pendingRequests.length > 0 || resolvedRequests.length > 0) && requestGated && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Join requests</h2>
          {pendingRequests.length === 0 && <p style={{ color: "#666" }}>None pending.</p>}
          {pendingRequests.map((r) => (
            <div key={r.id} style={{ marginBottom: "0.5rem" }}>
              <p style={{ margin: 0 }}>
                {memberNameById.get(r.memberId) ?? "—"} asked to join —{" "}
                {new Date(r.requestedAt).toLocaleString()}
              </p>
              {canApproveRequests && (
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                  <form action={acceptJoinRequestAction}>
                    <input type="hidden" name="taskId" value={taskRow.id} />
                    <input type="hidden" name="requestId" value={r.id} />
                    <button type="submit">Accept</button>
                  </form>
                  <form
                    action={declineJoinRequestAction}
                    style={{ display: "flex", gap: "0.5rem" }}
                  >
                    <input type="hidden" name="taskId" value={taskRow.id} />
                    <input type="hidden" name="requestId" value={r.id} />
                    <input
                      type="text"
                      name="reason"
                      placeholder="reason (optional)"
                      style={{ padding: "0.3rem" }}
                    />
                    <button type="submit">Decline</button>
                  </form>
                </div>
              )}
            </div>
          ))}

          {resolvedRequests.length > 0 && (
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
                Resolved requests ({resolvedRequests.length})
              </summary>
              <ul style={{ fontSize: "0.8rem" }}>
                {resolvedRequests.map((r) => (
                  <li key={r.id}>
                    {memberNameById.get(r.memberId) ?? "—"} — {r.status}
                    {r.status === "declined" && r.declineReason && `: ${r.declineReason}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {(subtasks.length > 0 || holdsTask) && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Subtasks</h2>
          {subtasks.length === 0 && <p style={{ color: "#666" }}>None broken off yet.</p>}
          {subtasks.length > 0 && (
            <ul>
              {subtasks.map((s) => (
                <li key={s.id}>
                  <Link href={`/tasks/${s.id}`} style={{ color: "inherit" }}>
                    {s.title}
                  </Link>{" "}
                  <span style={{ color: "#666", fontSize: "0.85rem" }}>({s.status})</span>
                </li>
              ))}
            </ul>
          )}

          {holdsTask && (
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
                Split off a subtask
              </summary>
              <form
                action={splitSubtaskAction}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  marginTop: "0.75rem",
                }}
              >
                <input type="hidden" name="taskId" value={taskRow.id} />
                <input
                  type="text"
                  name="title"
                  required
                  placeholder="Title"
                  style={{ padding: "0.4rem" }}
                />
                <textarea
                  name="description"
                  rows={2}
                  placeholder="Description"
                  style={{ padding: "0.4rem" }}
                />

                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                  <select name="branchId" defaultValue={taskRow.branchId} style={{ padding: "0.4rem" }}>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>

                  <select name="effort" required defaultValue={taskRow.effort} style={{ padding: "0.4rem" }}>
                    <option value="one_off">One-off</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="owns_a_thing">Owns-a-thing</option>
                  </select>

                  <select name="duration" defaultValue="few_hours" style={{ padding: "0.4rem" }}>
                    <option value="under_hour">Under an hour</option>
                    <option value="few_hours">A few hours</option>
                    <option value="half_day">Half a day</option>
                    <option value="multi_day">Multi-day</option>
                  </select>
                  <span style={{ fontSize: "0.8rem", color: "#666" }}>(if one-off)</span>

                  <input
                    type="number"
                    name="hoursPerWeek"
                    placeholder="hours/week"
                    min={0}
                    style={{ padding: "0.4rem", width: "8rem" }}
                  />
                  <span style={{ fontSize: "0.8rem", color: "#666" }}>(if ongoing/owns-a-thing)</span>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <label>
                    Capacity:{" "}
                    <input
                      type="number"
                      name="capacity"
                      defaultValue={1}
                      min={1}
                      style={{ padding: "0.4rem", width: "5rem" }}
                    />
                  </label>
                  <label>
                    <input type="checkbox" name="critical" /> Critical
                  </label>
                </div>

                <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
                  Split off
                </button>
              </form>
            </details>
          )}
        </section>
      )}

      <hr style={{ margin: "2rem 0" }} />
      <p style={{ color: "#666", fontSize: "0.85rem" }}>
        The description above is the goal, not the method. Everything below is optional notes on
        how it&rsquo;s actually been done — never mistaken for the instructions.
      </p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Wiki summary</h2>
        {notes.wikiRevisions.length > 0 ? (
          <div style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.75rem" }}>
            <p style={{ whiteSpace: "pre-wrap" }}>{notes.wikiRevisions[0].content}</p>
            <p style={{ fontSize: "0.8rem", color: "#666" }}>
              Last edited by {memberNameById.get(notes.wikiRevisions[0].editedBy) ?? "—"} on{" "}
              {new Date(notes.wikiRevisions[0].editedAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <p style={{ color: "#666" }}>Nothing written up yet.</p>
        )}

        <form
          action={editWikiAction}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}
        >
          <input type="hidden" name="taskId" value={taskRow.id} />
          <textarea
            name="content"
            rows={4}
            required
            defaultValue={notes.wikiRevisions[0]?.content ?? ""}
            placeholder="What's worked, what to watch out for, where the good deal was..."
            style={{ padding: "0.5rem" }}
          />
          <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
            Save wiki edit
          </button>
        </form>

        {notes.wikiRevisions.length > 1 && (
          <details style={{ marginTop: "0.5rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
              Revision history ({notes.wikiRevisions.length})
            </summary>
            <ul style={{ fontSize: "0.8rem" }}>
              {notes.wikiRevisions.slice(1).map((rev) => (
                <li key={rev.id}>
                  {memberNameById.get(rev.editedBy) ?? "—"} —{" "}
                  {new Date(rev.editedAt).toLocaleString()}: {rev.content}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Comments</h2>
        {notes.comments.length === 0 && <p style={{ color: "#666" }}>No comments yet.</p>}
        {notes.comments.map((c) => (
          <div key={c.id} style={{ marginBottom: "0.5rem" }}>
            <div style={{ fontSize: "0.8rem", color: "#666" }}>
              {memberNameById.get(c.memberId) ?? "—"} — {new Date(c.createdAt).toLocaleString()}
            </div>
            <p style={{ margin: 0 }}>{c.body}</p>
          </div>
        ))}

        <form action={addCommentAction} style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <input type="hidden" name="taskId" value={taskRow.id} />
          <input
            type="text"
            name="body"
            required
            placeholder="Add a comment…"
            style={{ padding: "0.4rem", flex: 1 }}
          />
          <button type="submit">Post</button>
        </form>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Resources</h2>
        {notes.resources.length === 0 && <p style={{ color: "#666" }}>No resources linked yet.</p>}
        <ul>
          {notes.resources.map((r) => (
            <li key={r.id}>
              <a href={r.url} target="_blank" rel="noopener noreferrer">
                {r.label}
              </a>
              {r.tag && <span style={{ color: "#666" }}> — {r.tag}</span>}
            </li>
          ))}
        </ul>

        <form
          action={addResourceAction}
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}
        >
          <input type="hidden" name="taskId" value={taskRow.id} />
          <input type="text" name="label" required placeholder="Label" style={{ padding: "0.4rem" }} />
          <input
            type="url"
            name="url"
            required
            placeholder="https://…"
            style={{ padding: "0.4rem", flex: 1 }}
          />
          <input
            type="text"
            name="tag"
            placeholder="tag (optional)"
            style={{ padding: "0.4rem" }}
          />
          <button type="submit">Add</button>
        </form>
      </section>
    </main>
  );
}
