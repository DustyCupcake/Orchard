import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { getTask, getTaskNotes, getUnmetRequirements, listRequirements, tierNameLookup, describeRequirement } from "@/lib/tasks";
import { ATTENTION_STYLES, effortSummary } from "@/lib/format";
import Nav from "@/components/Nav";
import { addCommentAction, addResourceAction, editWikiAction } from "./actions";

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
  const [branchRow, notes, requirements, unmetRequirements, tierNames] = await Promise.all([
    db.select().from(branch).where(eq(branch.id, taskRow.branchId)).then((r) => r[0]),
    getTaskNotes(currentMember, id),
    listRequirements(currentMember, id),
    getUnmetRequirements(db, currentMember, id),
    tierNameLookup(currentMember.communityId),
  ]);

  const memberIds = [
    ...new Set([
      ...taskRow.assignments.map((a) => a.memberId),
      ...notes.comments.map((c) => c.memberId),
      ...notes.wikiRevisions.map((w) => w.editedBy),
      ...notes.resources.map((r) => r.addedBy),
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
