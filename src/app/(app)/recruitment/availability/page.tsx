import { redirect } from "next/navigation";
import Link from "next/link";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { getStandingAvailability, isRecruitmentTaskHolder, STANDING_WINDOW_DAYS } from "@/lib/recruitment";
import AvailabilityGrid from "@/app/(app)/scheduling-polls/AvailabilityGrid";
import PageHeader from "@/components/ui/PageHeader";
import { requestTime } from "@/lib/request-time";

export const dynamic = "force-dynamic";

// docs/admission-flow.md §2: "the recruitment holders offer their own availability".
// One grid, covering the next few weeks, that a holder fills in and edits whenever
// they like. Every incoming interview is matched against it as it stands — it is
// read, not copied onto each one — so there is nothing to re-paint per person, and
// coming back after a week away and filling in the next one is enough to rescue an
// interview that was waiting for people.
export default async function StandingAvailabilityPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) redirect("/login");

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "recruitment");
  const holder = moduleOn && (await isRecruitmentTaskHolder(viewing));
  const row = holder ? await getStandingAvailability(viewing.id) : null;

  const nowMs = requestTime();
  const today = new Date(nowMs);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const rangeStart = iso(today);
  const rangeEnd = iso(new Date(nowMs + (STANDING_WINDOW_DAYS - 1) * 86_400_000));
  // A grid that has lapsed offers nothing, so what is shown as already chosen is only what still counts.
  const stillCounts = (row?.availableSlots as string[] | undefined)?.filter((s) => new Date(s).getTime() >= nowMs) ?? [];

  return (
    <main className="mx-auto max-w-[900px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader title="Your interview availability" />
      {!holder ? (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
          This is for people who hold the recruitment task — they offer the times they&rsquo;re free to talk with
          newcomers, once, here.{" "}
          <Link href="/recruitment" className="text-[var(--accent-1)] underline">
            Back to recruitment
          </Link>
        </p>
      ) : (
        <>
          <p className="mt-2 max-w-[640px] text-[length:var(--text-body)] text-[var(--text-muted)]">
            Paint the times in the next {STANDING_WINDOW_DAYS} days you&rsquo;re free to talk with someone joining. Every
            interview is matched against this as it stands — there&rsquo;s nothing to repeat for each person — and a time is
            only booked when the person and enough of you offered the same one. Come back and refresh it when the week
            changes; what you leave for dates that have passed simply drops away.
          </p>
          <div className="mt-6">
            <AvailabilityGrid
              pollId="standing"
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              initialSelected={stillCounts}
              readOnly={false}
              submitUrl="/api/recruitment/standing-availability"
            />
          </div>
        </>
      )}
    </main>
  );
}
