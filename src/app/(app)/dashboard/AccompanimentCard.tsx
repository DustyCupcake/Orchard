import type { member as memberTable } from "@/db/schema";
import { getMyAccompaniment } from "@/lib/accompaniment";
import { getViewerClock } from "@/lib/view-clock";
import { BUTTON_SECONDARY } from "@/components/ui/kit";
import { askForSomeoneElseAction } from "./actions";

type Member = typeof memberTable.$inferSelect;

// docs/plans/accompaniment-plan.md §4.1: a new member always knows who is accompanying
// them, what that means, and that they can say it isn't working. Says nothing at all for a
// member who has never had one, which is nearly everyone.
export default async function AccompanimentCard({ viewing }: { viewing: Member }) {
  const mine = await getMyAccompaniment(viewing.id);
  if (!mine) return null;
  const clock = await getViewerClock();

  if (mine.endedAt) {
    if (!mine.endedRecently) return null;
    return (
      <section className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-5">
        <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Your accompaniment has finished</h2>
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Thank you for letting someone be there for you while you found your feet. You can still ask anyone any
          question, any time.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-5">
      <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Your accompanier</h2>
      {mine.accompanier ? (
        <>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">
            <strong>{mine.accompanier.name}</strong> is accompanying you: someone you can ask questions of and check
            in with while you find your feet. They can see whether you are keeping up with what you have taken on,
            and nothing else about you.
          </p>
          <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
            Until {clock.date(mine.endsOn)}. If it isn&rsquo;t a good fit, you can ask for someone else, and nobody will
            mind.
          </p>
          <form action={askForSomeoneElseAction} className="mt-3">
            <button type="submit" className={BUTTON_SECONDARY}>
              Ask for someone else
            </button>
          </form>
        </>
      ) : (
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">
          Someone will be named soon to accompany you: a person you can ask questions of and check in with while you find
          your feet.{" "}
          {mine.askedForSomeoneElseAt
            ? "You asked for someone else, and the request is out again."
            : "You'll get an email as soon as somebody has taken it on."}
        </p>
      )}
    </section>
  );
}
