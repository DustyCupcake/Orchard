import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { canInitiateCycle } from "@/lib/cycles";
import {
  isAnnouncementTaskHolder,
  listMyCoordinatedBranches,
  listMyHeldTasksForMessaging,
  listOutboundMessagesVisibleTo,
} from "@/lib/messages";
import { sendMessageAction } from "./actions";

export const dynamic = "force-dynamic";

const SCOPE_LABEL: Record<string, string> = {
  branch: "Branch",
  task_holders: "Task holders",
  arrival_window: "Arrival window",
  community: "Community announcement",
};

function describeScope(scope: string, scopeRef: unknown): string {
  if (scope === "arrival_window") {
    const ref = scopeRef as { start?: string; end?: string };
    return `${SCOPE_LABEL[scope]}: ${ref.start ?? "?"} – ${ref.end ?? "?"}`;
  }
  return SCOPE_LABEL[scope] ?? scope;
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const [coordinatedBranches, heldTasks, canArrivalWindow, canAnnounce, sentMessages] = await Promise.all([
    listMyCoordinatedBranches(currentMember),
    listMyHeldTasksForMessaging(currentMember),
    canInitiateCycle(currentMember),
    isAnnouncementTaskHolder(currentMember),
    listOutboundMessagesVisibleTo(currentMember),
  ]);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1>Messages</h1>
      <p style={{ color: "#666", fontSize: "0.85rem" }}>
        Every send is logged below — an announcement&rsquo;s log is visible to everyone; a targeted
        message&rsquo;s log is visible only to you and whoever it went to. Delivery follows each
        member&rsquo;s own email preference (see /profile).
      </p>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {coordinatedBranches.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Message a branch you coordinate</h2>
          <form action={sendMessageAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <input type="hidden" name="scope" value="branch" />
            <select name="branchId" required style={{ padding: "0.4rem" }}>
              {coordinatedBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <input type="text" name="subject" placeholder="Subject" required style={{ padding: "0.4rem" }} />
            <textarea name="body" placeholder="Message" required rows={3} style={{ padding: "0.4rem" }} />
            <button type="submit" style={{ padding: "0.4rem 0.8rem", width: "fit-content" }}>
              Send to branch
            </button>
          </form>
        </section>
      )}

      {heldTasks.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Message everyone holding a task with you</h2>
          <form action={sendMessageAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <input type="hidden" name="scope" value="task_holders" />
            <select name="taskId" required style={{ padding: "0.4rem" }}>
              {heldTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <input type="text" name="subject" placeholder="Subject" required style={{ padding: "0.4rem" }} />
            <textarea name="body" placeholder="Message" required rows={3} style={{ padding: "0.4rem" }} />
            <button type="submit" style={{ padding: "0.4rem 0.8rem", width: "fit-content" }}>
              Send to co-holders
            </button>
          </form>
        </section>
      )}

      {canArrivalWindow && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Message people arriving in a window</h2>
          <p style={{ color: "#666", fontSize: "0.8rem" }}>
            Goes to everyone marked coming/maybe for the current cycle whose declared arrival date
            falls in this range.
          </p>
          <form action={sendMessageAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <input type="hidden" name="scope" value="arrival_window" />
            <label style={{ fontSize: "0.85rem" }}>
              From <input type="date" name="start" required style={{ padding: "0.3rem" }} />
            </label>
            <label style={{ fontSize: "0.85rem" }}>
              To <input type="date" name="end" required style={{ padding: "0.3rem" }} />
            </label>
            <input type="text" name="subject" placeholder="Subject" required style={{ padding: "0.4rem" }} />
            <textarea name="body" placeholder="Message" required rows={3} style={{ padding: "0.4rem" }} />
            <button type="submit" style={{ padding: "0.4rem 0.8rem", width: "fit-content" }}>
              Send to arrivals
            </button>
          </form>
        </section>
      )}

      {canAnnounce && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Send a community-wide announcement</h2>
          <p style={{ color: "#666", fontSize: "0.8rem" }}>Goes to every member in the community.</p>
          <form action={sendMessageAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <input type="hidden" name="scope" value="community" />
            <input type="text" name="subject" placeholder="Subject" required style={{ padding: "0.4rem" }} />
            <textarea name="body" placeholder="Message" required rows={3} style={{ padding: "0.4rem" }} />
            <button type="submit" style={{ padding: "0.4rem 0.8rem", width: "fit-content" }}>
              Send announcement
            </button>
          </form>
        </section>
      )}

      {coordinatedBranches.length === 0 && heldTasks.length === 0 && !canArrivalWindow && !canAnnounce && (
        <p style={{ color: "#666", marginTop: "1.5rem" }}>
          You don&rsquo;t currently have access to send anything — coordinate a branch, hold a task
          with a co-holder, be eligible to start a cycle, or hold the announcement task.
        </p>
      )}

      <section style={{ marginTop: "2rem" }}>
        <h2>Sent messages</h2>
        {sentMessages.length === 0 && <p style={{ color: "#666" }}>Nothing sent yet.</p>}
        {sentMessages.map((m) => (
          <div
            key={m.id}
            style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
          >
            <strong>{m.subject}</strong>
            <span style={{ color: "#666", fontSize: "0.8rem" }}>
              {" "}
              — {describeScope(m.scope, m.scopeRef)} — {new Date(m.sentAt).toLocaleString()}
            </span>
            <p style={{ margin: "0.4rem 0 0", whiteSpace: "pre-wrap" }}>{m.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
