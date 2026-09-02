import { getIntroCallAvailability, getIntroCallByToken } from "@/lib/recruitment";
import AvailabilityGrid from "@/app/(app)/scheduling-polls/AvailabilityGrid";

export const dynamic = "force-dynamic";

// Public, no login required — "the applicant is tracked by the
// contact info on their own FormResponse and sent the poll link
// directly — submitting blind availability the same way anyone else
// would, without needing a Member row to do it" (docs/development-
// plan.md's Phase 34). Reuses the exact same drag-select grid the
// authenticated /scheduling-polls/[id] page uses, just pointed at the
// public submission endpoint.
export default async function IntroCallPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await getIntroCallByToken(token);

  if (!found) {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
        <h1>Intro call</h1>
        <p style={{ color: "crimson" }}>This link isn&rsquo;t valid.</p>
      </main>
    );
  }

  const { poll } = found;
  const myAvailability = await getIntroCallAvailability(token);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 900 }}>
      <h1>Intro call</h1>
      <p style={{ color: "#666" }}>
        Paint the windows you&rsquo;re free to talk — nobody, including you, sees anyone else&rsquo;s
        submission until a time is confirmed.
      </p>

      {poll.confirmedSlotStart && poll.confirmedSlotEnd ? (
        <p style={{ color: "#2a7a2a" }}>
          Confirmed: {new Date(poll.confirmedSlotStart).toLocaleString()} –{" "}
          {new Date(poll.confirmedSlotEnd).toLocaleTimeString()}
        </p>
      ) : (
        <AvailabilityGrid
          pollId={token}
          rangeStart={poll.rangeStart}
          rangeEnd={poll.rangeEnd}
          initialSelected={myAvailability}
          readOnly={false}
          submitUrl={`/api/intro-call/${token}/availability`}
        />
      )}
    </main>
  );
}
