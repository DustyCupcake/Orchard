import Link from "next/link";
import type { member as memberTable } from "@/db/schema";
import { listMyCompanionRequests } from "@/lib/recruitment/interview-companions";
import { getViewerClock } from "@/lib/view-clock";
import { BUTTON_GHOST, BUTTON_PRIMARY } from "@/components/ui/kit";
import { answerCompanionRequestAction } from "./actions";

type Member = typeof memberTable.$inferSelect;

// docs/plans/accompaniment-plan.md §6. Somebody this member invited has asked whether they would like to
// be at their interview, as company. A pull on their own dashboard, not an email. Saying no needs no
// reason and tells nobody; saying yes is "I'd like to come", with a way to say when they're free so a
// time can be chosen that they can make, which is preferred and never required. Says nothing when
// there is nothing to say.
export default async function CompanionRequests({ viewing }: { viewing: Member }) {
  const requests = await listMyCompanionRequests(viewing);
  if (requests.length === 0) return null;
  const clock = await getViewerClock();
  return (
    <section className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-5">
      <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Someone you invited would like you there</h2>
      <ul className="mt-2 flex flex-col gap-4">
        {requests.map((r) => (
          <li key={r.arrivalId}>
            {r.status === "requested" ? (
              <>
                <p className="text-[length:var(--text-body)] text-[var(--text)]">
                  <strong>{r.personName}</strong>, whom you invited, would like you to be at their interview, for company. It
                  changes nothing about how anyone decides.{" "}
                  {r.confirmedStart ? `It's booked for ${clock.deadline(r.confirmedStart)}.` : "A time hasn't been chosen yet."}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <form action={answerCompanionRequestAction}>
                    <input type="hidden" name="arrivalId" value={r.arrivalId} />
                    <input type="hidden" name="accept" value="1" />
                    <button type="submit" className={BUTTON_PRIMARY}>
                      I&rsquo;d like to come
                    </button>
                  </form>
                  <form action={answerCompanionRequestAction}>
                    <input type="hidden" name="arrivalId" value={r.arrivalId} />
                    <input type="hidden" name="accept" value="0" />
                    <button type="submit" className={BUTTON_GHOST}>
                      Not this time
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <>
                <p className="text-[length:var(--text-body)] text-[var(--text)]">
                  You&rsquo;ll be at <strong>{r.personName}</strong>&rsquo;s interview if you can.{" "}
                  {r.confirmedStart ? `It's booked for ${clock.deadline(r.confirmedStart)}.` : "A time hasn't been chosen yet."}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {r.pollId && !r.confirmedStart && (
                    <Link href={`/scheduling-polls/${r.pollId}`} className="text-[length:var(--text-body)] text-[var(--accent-1)] hover:underline">
                      Say when you&rsquo;re free
                    </Link>
                  )}
                  <form action={answerCompanionRequestAction}>
                    <input type="hidden" name="arrivalId" value={r.arrivalId} />
                    <input type="hidden" name="accept" value="0" />
                    <button type="submit" className={BUTTON_GHOST}>
                      I can&rsquo;t after all
                    </button>
                  </form>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
