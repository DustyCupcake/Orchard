import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { Banner, BUTTON_PRIMARY, INPUT, LABEL } from "@/components/ui/kit";
import { submitProposal } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProposePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const communityMembers = await db
    .select()
    .from(member)
    .where(eq(member.communityId, viewing.communityId));

  return (
    <main className="mx-auto max-w-[520px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Propose a task</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Just a title and a rough description is enough — no need to know its branch, tags, or
        criticality. Whoever does branch coordination will fill that in when they review it.
      </p>

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}

      <form action={submitProposal} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Title</span>
          <input type="text" name="title" required className={INPUT} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Description (optional, rough is fine)</span>
          <textarea name="description" rows={4} className={INPUT} />
        </label>

        <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
          <input type="checkbox" name="wantsToClaim" /> I&rsquo;d like to claim this myself
        </label>

        <fieldset className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <legend className="px-1 text-[12px] text-[var(--text-muted)]">I&rsquo;d suggest this person (optional)</legend>
          <select name="suggestedMemberId" defaultValue="" className={`${INPUT} w-full`}>
            <option value="">— nobody in particular —</option>
            {communityMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            name="suggestedMemberNote"
            placeholder="why they'd be a good fit (optional)"
            className={`${INPUT} mt-2 w-full`}
          />
        </fieldset>

        <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
          Submit proposal
        </button>
      </form>
    </main>
  );
}
