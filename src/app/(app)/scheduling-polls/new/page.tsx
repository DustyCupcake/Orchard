import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { Banner, BUTTON_PRIMARY, INPUT, LABEL } from "@/components/ui/kit";
import { proposePollAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NewSchedulingPollPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; branchId?: string; title?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  // Pre-filled when opened from a task's own "Schedule a poll" button
  // (src/app/(app)/tasks/[id]/page.tsx) — a plain query-param default,
  // same as everywhere else this codebase prefers a link over client JS.
  const { error, branchId: presetBranchId, title: presetTitle } = await searchParams;

  const [branches, members] = await Promise.all([
    db.select().from(branch).where(eq(branch.communityId, viewing.communityId)),
    db.select().from(member).where(eq(member.communityId, viewing.communityId)),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-[560px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Open a scheduling poll</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Members submit their own availability blind — you&rsquo;ll only see the aggregate overlap,
        never who submitted what, until you confirm a slot.
      </p>

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}

      <form action={proposePollAction} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Title</span>
          <input type="text" name="title" required defaultValue={presetTitle ?? ""} className={INPUT} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Branch</span>
          <select name="branchId" required defaultValue={presetBranchId ?? ""} className={INPUT}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <legend className="px-1 text-[12px] text-[var(--text-muted)]">Resolution</legend>
          <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
            <input type="radio" name="resolutionMode" value="max_attendance" defaultChecked /> Maximize
            attendance above a threshold — open to whoever&rsquo;s relevant
          </label>
          <label className="mt-2 flex flex-col gap-1">
            <span className={LABEL}>Minimum attendance to confirm a slot</span>
            <input type="number" name="minAttendance" min={1} defaultValue={1} className={`${INPUT} w-24`} />
          </label>

          <label className="mt-3 flex items-center gap-2 text-[13px] text-[var(--text)]">
            <input type="radio" name="resolutionMode" value="must_overlap" /> Must overlap specific people —
            a slot missing any of them isn&rsquo;t an option
          </label>
          <div className="mt-1 flex flex-col gap-0.5 pl-6">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                <input type="checkbox" name="requiredParticipantIds" value={m.id} /> {m.name}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={LABEL}>From</span>
            <input type="date" name="rangeStart" required defaultValue={today} className={INPUT} />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={LABEL}>To</span>
            <input type="date" name="rangeEnd" required defaultValue={nextWeek} className={INPUT} />
          </label>
        </div>

        <fieldset className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <legend className="px-1 text-[12px] text-[var(--text-muted)]">
            Agenda &amp; summary (each falls back to this branch&rsquo;s, then the Community&rsquo;s, default)
          </legend>
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between gap-2 text-[13px] text-[var(--text)]">
              Open agenda
              <select name="hasAgenda" defaultValue="" className={INPUT}>
                <option value="">Inherit default</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-[13px] text-[var(--text)]">
              Expected summary
              <select name="needsSummary" defaultValue="" className={INPUT}>
                <option value="">Inherit default</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-[13px] text-[var(--text)]">
              Require read-confirmation
              <select name="requireRead" defaultValue="" className={INPUT}>
                <option value="">Inherit default</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </label>
          </div>
        </fieldset>

        <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
          Open poll
        </button>
      </form>
    </main>
  );
}
