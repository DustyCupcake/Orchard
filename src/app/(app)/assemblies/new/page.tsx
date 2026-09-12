import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { Banner, BUTTON_PRIMARY, INPUT, LABEL } from "@/components/ui/kit";
import { proposeAssemblyAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NewAssemblyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error } = await searchParams;

  return (
    <main className="mx-auto max-w-[520px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Propose an Assembly</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Every duration is yours to set — compress agenda and notice to nearly nothing for
        something urgent, or give a slow, structural question real time to breathe. All three
        durations are in minutes (60 = 1 hour, 1440 = 1 day, 10080 = 1 week).
      </p>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Once proposed, the Assembly moves through those windows in order: during{" "}
        <strong className="text-[var(--text)]">agenda-building</strong>, any member can add agenda
        items — the specific questions or motions people will vote on. During{" "}
        <strong className="text-[var(--text)]">notice</strong>, that agenda is locked and visible
        but voting hasn&rsquo;t opened yet. Then <strong className="text-[var(--text)]">voting</strong>{" "}
        opens, and once it closes the results are tallied and published — advisory only, never
        applied automatically.
      </p>

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <form action={proposeAssemblyAction} className="mt-6 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Title</span>
          <input type="text" name="title" required className={INPUT} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Description (optional)</span>
          <textarea name="description" rows={4} className={INPUT} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Agenda-building window (minutes)</span>
          <input type="number" name="agendaMinutes" min={0} required defaultValue={1440} className={INPUT} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Notice window (minutes) — agenda locked and visible, voting not open yet</span>
          <input type="number" name="noticeMinutes" min={0} required defaultValue={1440} className={INPUT} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Voting window (minutes)</span>
          <input type="number" name="votingMinutes" min={1} required defaultValue={4320} className={INPUT} />
        </label>

        <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
          Propose
        </button>
      </form>
    </main>
  );
}
