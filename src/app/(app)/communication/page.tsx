import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getPersonalFeed } from "@/lib/dashboard";
import { Banner } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";
import { respondToNominationAction } from "./actions";

export const dynamic = "force-dynamic";

const MESSAGE_SCOPE_LABEL: Record<string, string> = {
  branch: "a branch you belong to",
  task_holders: "your task's holders",
  arrival_window: "your arrival window",
  cycle: "your event roster",
  community: "everyone",
};

// The Communication group's dashboard (nav-config.ts's "Communication"
// headerIsLink → /communication) — the single needs-you attention
// surface. One section per communication type, each hidden when empty
// and headed by a link to the working page for that type:
//   - input rounds  → /input-rounds   (answer open questions)
//   - messages      → /messages       (everything sent your way)
//   - feedback      → /feedback       (post-cycle survey / reviews)
//   - nominations   → /board          (respond inline below)
//   - date invites  → /calendar       (accept / decline over there)
//   - polls         → /scheduling-polls (submit availability)
// The header deliberately carries no primary action ("most people won't
// have the send-a-message option") — the send surfaces live on each
// type's own page top-right, deep-linked from the headings below.

function SectionHeading({ href, title }: { href: string; title: string }) {
  return (
    <h2 className="mb-1 text-[15px] font-medium">
      <Link href={href} className="text-[var(--text)] hover:text-[var(--accent-1)]">
        {title}
      </Link>
    </h2>
  );
}

function Row({ href, title, meta }: { href: string; title: string; meta?: React.ReactNode }) {
  return (
    <li className="border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] px-1 py-2.5 hover:bg-[var(--surface-sunken)]">
        <div className="min-w-0">
          <Link href={href} className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
            {title}
          </Link>
          {meta && <div className="mt-0.5 text-[13px] text-[var(--text-muted)]">{meta}</div>}
        </div>
      </div>
    </li>
  );
}

function Section({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <SectionHeading href={href} title={title} />
      <ul>{children}</ul>
    </section>
  );
}

export default async function CommunicationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const [feed, branchRows] = await Promise.all([
    getPersonalFeed(viewing),
    db
      .select({ id: branch.id, name: branch.name })
      .from(branch)
      .where(eq(branch.communityId, viewing.communityId)),
  ]);
  const branchNameById = new Map(branchRows.map((b) => [b.id, b.name]));

  // Every section below reads off the one cache()'d feed — getPersonalFeed
  // now pulls all six Inbox surfaces (see src/lib/dashboard.ts), so the
  // sidebar's Communication badge and this page can never drift apart,
  // and the page no longer re-queries the same surfaces itself.
  const unansweredQuestions = feed.inboxUnansweredQuestions;
  const visibleMessages = feed.inboxVisibleMessages;
  const reviewResponseCount = feed.inboxFeedbackReviewCount;
  const pollsNeedingMe = feed.inboxPollsNeedingMe;

  const anySectionHasItems =
    unansweredQuestions.length > 0 ||
    visibleMessages.length > 0 ||
    feed.inboxFeedbackOpen ||
    feed.pendingNominations.length > 0 ||
    feed.calendarEventInvites.length > 0 ||
    pollsNeedingMe.length > 0;

  return (
    <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Inbox"
        description="Everything that's waiting on you — questions to answer, messages sent your way, and feedback to give or review."
      />

      {error && (
        <div className="mb-5">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {!anySectionHasItems && (
        <p className="mt-6 text-[13px] text-[var(--text-muted)]">
          Nothing waiting on you right now — it&rsquo;ll light up here the moment any of these surfaces needs you.
        </p>
      )}

      {unansweredQuestions.length > 0 && (
        <Section href="/input-rounds" title={`Input rounds (${unansweredQuestions.length})`}>
          {unansweredQuestions.map((q) => (
            <Row
              key={q.id}
              href="/input-rounds"
              title={q.text}
              meta={
                <>
                  on {q.taskTitle} · {q.branchName}
                  {q.deadline && <> · needed by {new Date(q.deadline).toLocaleDateString()}</>}
                </>
              }
            />
          ))}
        </Section>
      )}

      {visibleMessages.length > 0 && (
        <Section href="/messages" title="Messages to you">
          {visibleMessages.slice(0, 5).map((m) => (
            <Row
              key={m.id}
              href="/messages"
              title={m.subject}
              meta={
                <>
                  to {MESSAGE_SCOPE_LABEL[m.scope] ?? m.scope} · {new Date(m.sentAt).toLocaleString()}
                </>
              }
            />
          ))}
          {visibleMessages.length > 5 && (
            <Row href="/messages" title={`And ${visibleMessages.length - 5} more`} meta="See the full log on the Messages page" />
          )}
        </Section>
      )}

      {feed.inboxFeedbackOpen && (
        <Section href="/feedback" title="Feedback">
          <Row
            href="/feedback"
            title="Give your feedback on the latest event"
            meta="Post-event survey — pick an event and submit; the reviewer sees responses here too."
          />
          {reviewResponseCount > 0 && (
            <Row
              href="/feedback"
              title={`${reviewResponseCount} response${reviewResponseCount === 1 ? "" : "s"} awaiting your review`}
              meta="As the feedback-review task holder"
            />
          )}
        </Section>
      )}

      {feed.pendingNominations.length > 0 && (
        <Section href="/board" title={`Task nominations (${feed.pendingNominations.length})`}>
          <p className="-mt-0.5 mb-2 text-[13px] text-[var(--text-muted)]">
            You&rsquo;re already holding these — a yes, no, or not-now are all fine. No response by the
            deadline releases it back automatically.
          </p>
          {feed.pendingNominations.map(({ nomination, taskTitle, nominatorName }) => (
            <li key={nomination.id} className="border-b border-[var(--border)] px-1 py-2.5 last:border-b-0">
              <Link href={`/tasks/${nomination.taskId}`} className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                {taskTitle}
              </Link>{" "}
              <span className="text-[13px] text-[var(--text-muted)]">
                — {nominatorName} thinks this is a fit, respond by {new Date(nomination.respondByDeadline).toLocaleString()}
                {nomination.message && <>: &ldquo;{nomination.message}&rdquo;</>}
              </span>
              <form action={respondToNominationAction} className="mt-2 flex gap-2">
                <input type="hidden" name="nominationId" value={nomination.id} />
                <button
                  type="submit"
                  name="response"
                  value="accepted"
                  className="rounded-[var(--radius-md)] bg-[var(--accent-1)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-1-fg)] hover:bg-[var(--accent-1-hover)]"
                >
                  Accept
                </button>
                <button
                  type="submit"
                  name="response"
                  value="declined"
                  className="rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1.5 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--neutral-100)]"
                >
                  Not for me
                </button>
                <button
                  type="submit"
                  name="response"
                  value="not_now"
                  className="rounded-[var(--radius-md)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--accent-1)] hover:bg-[var(--accent-1-softer)]"
                >
                  Not right now
                </button>
              </form>
            </li>
          ))}
        </Section>
      )}

      {feed.calendarEventInvites.length > 0 && (
        <Section href="/calendar" title={`Date invites (${feed.calendarEventInvites.length})`}>
          {feed.calendarEventInvites.map((i) => (
            <Row
              key={i.eventId}
              href="/calendar"
              title={i.eventTitle}
              meta={`invited by ${i.invitedByName}, ${new Date(i.invitedAt).toLocaleDateString()} — respond on the calendar`}
            />
          ))}
        </Section>
      )}

      {pollsNeedingMe.length > 0 && (
        <Section href="/scheduling-polls" title={`Scheduling polls (${pollsNeedingMe.length})`}>
          {pollsNeedingMe.map((p) => (
            <Row
              key={p.id}
              href={`/scheduling-polls/${p.id}`}
              title={p.title}
              meta={`${branchNameById.get(p.branchId) ?? "—"} · submit your availability`}
            />
          ))}
        </Section>
      )}
    </main>
  );
}