import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { canInitiateCycle, listCycles } from "@/lib/cycles";
import {
  isAnnouncementTaskHolder,
  listMyAnnouncementCycles,
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
  cycle: "Event roster",
  community: "Community announcement",
};

function describeScope(scope: string, scopeRef: unknown, cycleNameById: Map<string, string>): string {
  if (scope === "arrival_window") {
    const ref = scopeRef as { start?: string; end?: string };
    return `${SCOPE_LABEL[scope]}: ${ref.start ?? "?"} – ${ref.end ?? "?"}`;
  }
  if (scope === "cycle") {
    const ref = scopeRef as { cycleId?: string; segments?: string[] };
    const name = ref.cycleId ? (cycleNameById.get(ref.cycleId) ?? "?") : "?";
    const segments = (ref.segments ?? []).join(" + ");
    return `${SCOPE_LABEL[scope]}: ${name}${segments ? ` — ${segments}` : ""}`;
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

  const [coordinatedBranches, heldTasks, canArrivalWindow, canAnnounce, myAnnouncementCycles, allCycles, sentMessages] =
    await Promise.all([
      listMyCoordinatedBranches(viewing),
      listMyHeldTasksForMessaging(viewing),
      canInitiateCycle(viewing),
      isAnnouncementTaskHolder(viewing),
      listMyAnnouncementCycles(viewing),
      listCycles(viewing),
      listOutboundMessagesVisibleTo(viewing),
    ]);
  const cycleNameById = new Map(allCycles.map((c) => [c.id, c.name] as const));

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
            Goes to everyone marked coming/maybe for the current event whose declared arrival date
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

      {myAnnouncementCycles.length > 0 && (
        <section className="mt-6">
          <SectionHeading>Message an event roster</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Goes to members who&rsquo;ve said they&rsquo;re coming and/or maybe for the chosen event.
            Pick which of those two groups should get it — they often need different messages.
          </p>
          <form action={sendMessageAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="scope" value="cycle" />
            <select name="cycleId" required className={INPUT}>
              {myAnnouncementCycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5 text-[13px] text-[var(--text)]">
                <input type="checkbox" name="segments" value="coming" defaultChecked />
                Coming
              </label>
              <label className="flex items-center gap-1.5 text-[13px] text-[var(--text)]">
                <input type="checkbox" name="segments" value="maybe" defaultChecked />
                Maybe
              </label>
            </div>
            <input type="text" name="subject" placeholder="Subject" required className={INPUT} />
            <textarea name="body" placeholder="Message" required rows={3} className={INPUT} />
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Send to event roster
            </button>
          </form>
        </section>
      )}

      {canAnnounce && (
        <section className="mt-6">
          <SectionHeading>Send a community-wide announcement</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Goes to every member in the community. An event-placed announcement task messages that
            event&rsquo;s roster instead — see above.
          </p>
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

      {coordinatedBranches.length === 0 &&
        heldTasks.length === 0 &&
        !canArrivalWindow &&
        !canAnnounce &&
        myAnnouncementCycles.length === 0 && (
          <p className="mt-6 text-[13px] text-[var(--text-muted)]">
            You don&rsquo;t currently have access to send anything — coordinate a branch, hold a task
            with a co-holder, be eligible to start an event, or hold an announcement task.
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
                {describeScope(m.scope, m.scopeRef, cycleNameById)} — {new Date(m.sentAt).toLocaleString()}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-[13px] text-[var(--text)]">{m.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
