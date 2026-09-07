import { getIntroCallAvailability, getIntroCallByToken } from "@/lib/recruitment";
import AvailabilityGrid from "@/app/(app)/scheduling-polls/AvailabilityGrid";
import { Banner } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

// Public, no login required — "the applicant is tracked by the
// contact info on their own FormResponse and sent the poll link
// directly — submitting blind availability the same way anyone else
// would, without needing a Member row to do it" (docs/development-
// plan.md's Phase 34). Reuses the exact same drag-select grid the
// authenticated /scheduling-polls/[id] page uses, just pointed at the
// public submission endpoint — AvailabilityGrid itself is untouched
// here (its own restyle is tracked separately, see
// design_handoff_conventions/README.md), only the surrounding page
// chrome moved onto tokens.
export default async function IntroCallPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await getIntroCallByToken(token);

  if (!found) {
    return (
      <main className="mx-auto max-w-[480px] px-6 py-16">
        <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Intro call</h1>
        <div className="mt-4">
          <Banner tone="danger">This link isn&rsquo;t valid.</Banner>
        </div>
      </main>
    );
  }

  const { poll } = found;
  const myAvailability = await getIntroCallAvailability(token);

  return (
    <main className="mx-auto max-w-[900px] px-6 py-16">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Intro call</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Paint the windows you&rsquo;re free to talk — nobody, including you, sees anyone else&rsquo;s
        submission until a time is confirmed.
      </p>

      {poll.confirmedSlotStart && poll.confirmedSlotEnd ? (
        <div className="mt-4">
          <Banner tone="success">
            Confirmed: {new Date(poll.confirmedSlotStart).toLocaleString()} –{" "}
            {new Date(poll.confirmedSlotEnd).toLocaleTimeString()}
          </Banner>
        </div>
      ) : (
        <div className="mt-6">
          <AvailabilityGrid
            pollId={token}
            rangeStart={poll.rangeStart}
            rangeEnd={poll.rangeEnd}
            initialSelected={myAvailability}
            readOnly={false}
            submitUrl={`/api/intro-call/${token}/availability`}
          />
        </div>
      )}
    </main>
  );
}
