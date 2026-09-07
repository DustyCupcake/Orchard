import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { canInitiateCycle } from "@/lib/cycles";
import {
  isAnnouncementTaskHolder,
  listMyCoordinatedBranches,
  listMyHeldTasksForMessaging,
  listOutboundMessagesVisibleTo,
} from "@/lib/messages";
import { Banner, BUTTON_PRIMARY, CARD, INPUT, LABEL } from "@/components/ui/kit";
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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const [coordinatedBranches, heldTasks, canArrivalWindow, canAnnounce, sentMessages] = await Promise.all([
    listMyCoordinatedBranches(viewing),
    listMyHeldTasksForMessaging(viewing),
    canInitiateCycle(viewing),
    isAnnouncementTaskHolder(viewing),
    listOutboundMessagesVisibleTo(viewing),
  ]);

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Messages</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Every send is logged below — an announcement&rsquo;s log is visible to everyone; a targeted
        message&rsquo;s log is visible only to you and whoever it went to. Delivery follows each
        member&rsquo;s own email preference (see /profile).
      </p>
      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {coordinatedBranches.length > 0 && (
        <section className="mt-6">
          <SectionHeading>Message a branch you coordinate</SectionHeading>
          <form action={sendMessageAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="scope" value="branch" />
            <select name="branchId" required className={INPUT}>
              {coordinatedBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <input type="text" name="subject" placeholder="Subject" required className={INPUT} />
            <textarea name="body" placeholder="Message" required rows={3} className={INPUT} />
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Send to branch
            </button>
          </form>
        </section>
      )}

      {heldTasks.length > 0 && (
        <section className="mt-6">
          <SectionHeading>Message everyone holding a task with you</SectionHeading>
          <form action={sendMessageAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="scope" value="task_holders" />
            <select name="taskId" required className={INPUT}>
              {heldTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <input type="text" name="subject" placeholder="Subject" required className={INPUT} />
            <textarea name="body" placeholder="Message" required rows={3} className={INPUT} />
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Send to co-holders
            </button>
          </form>
        </section>
      )}

      {canArrivalWindow && (
        <section className="mt-6">
          <SectionHeading>Message people arriving in a window</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Goes to everyone marked coming/maybe for the current cycle whose declared arrival date
            falls in this range.
          </p>
          <form action={sendMessageAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="scope" value="arrival_window" />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>From</span>
              <input type="date" name="start" required className={`${INPUT} w-fit`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>To</span>
              <input type="date" name="end" required className={`${INPUT} w-fit`} />
            </label>
            <input type="text" name="subject" placeholder="Subject" required className={INPUT} />
            <textarea name="body" placeholder="Message" required rows={3} className={INPUT} />
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Send to arrivals
            </button>
          </form>
        </section>
      )}

      {canAnnounce && (
        <section className="mt-6">
          <SectionHeading>Send a community-wide announcement</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">Goes to every member in the community.</p>
          <form action={sendMessageAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="scope" value="community" />
            <input type="text" name="subject" placeholder="Subject" required className={INPUT} />
            <textarea name="body" placeholder="Message" required rows={3} className={INPUT} />
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Send announcement
            </button>
          </form>
        </section>
      )}

      {coordinatedBranches.length === 0 && heldTasks.length === 0 && !canArrivalWindow && !canAnnounce && (
        <p className="mt-6 text-[13px] text-[var(--text-muted)]">
          You don&rsquo;t currently have access to send anything — coordinate a branch, hold a task
          with a co-holder, be eligible to start a cycle, or hold the announcement task.
        </p>
      )}

      <section className="mt-8">
        <SectionHeading>Sent messages</SectionHeading>
        {sentMessages.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">Nothing sent yet.</p>}
        <div className="mt-3 flex flex-col gap-2">
          {sentMessages.map((m) => (
            <div key={m.id} className={CARD}>
              <p className="text-[14px] font-medium text-[var(--text)]">{m.subject}</p>
              <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                {describeScope(m.scope, m.scopeRef)} — {new Date(m.sentAt).toLocaleString()}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-[13px] text-[var(--text)]">{m.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
