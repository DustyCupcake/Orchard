import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { isModuleEnabled } from "@/lib/modules";
import { getCommunityRow, listOpenChecksForMember } from "@/lib/recruitment";
import PageHeader from "@/components/ui/PageHeader";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag } from "@/components/ui/kit";
import { raiseConcernAction, withdrawConcernAction } from "./actions";

export const dynamic = "force-dynamic";

const KIND_LABEL = {
  entry: "Announced to the community when they joined",
  evaluation: "Read by the people who met them; now open to the whole community",
} as const;

// docs/admission-flow.md §5 — the one place a member raises a concern about
// someone who is arriving. Every arrival whose community check is open is listed
// here, whichever way the window opened, and the form is the same for all of them.
//
// What it says about the person is their name and how they came, and nothing from
// their application: what the people who read it saw is for them to weigh, and a
// member who raises a concern is raising it about the arrival.
export default async function CommunityCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; raised?: string; withdrawn?: string }>;
}) {
  const { error, raised, withdrawn } = await searchParams;
  const ctx = await getViewingContext();
  if (!ctx.real || !ctx.viewing) redirect("/login");
  const actor = ctx.viewing;

  const communityRow = await getCommunityRow(actor.communityId);
  if (!isModuleEnabled(communityRow, "recruitment")) {
    return (
      <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
        <PageHeader title="Community check" />
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">Recruitment is switched off for this community.</p>
      </main>
    );
  }

  const open = await listOpenChecksForMember(actor);

  return (
    <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Community check"
        description="People whose arrival the community has a say in. If you know something the community should weigh, say it here — it goes privately to the mediation body, not to the person, their inviter or the people who evaluate them."
        actions={
          <Link href="/recruitment" className="text-[length:var(--text-body)] text-[var(--accent-1)] hover:underline">
            Back to recruitment
          </Link>
        }
      />

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      {raised && (
        <div className="mt-4">
          <Banner tone="success">
            Your concern is with the mediation body. It holds their arrival until it has been talked through, and nobody
            will be told it was you.
          </Banner>
        </div>
      )}

      {withdrawn && (
        <div className="mt-4">
          <Banner tone="success">Your concern is withdrawn.</Banner>
        </div>
      )}

      {open.length === 0 ? (
        <p className="mt-6 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Nobody is waiting on the community right now. When somebody&rsquo;s arrival is announced, or the people who met them
          have reported and the community has its say, they appear here for as long as the window is open.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {open.map((item) => (
            <article key={item.arrivalId} className={CARD}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{item.name}</h2>
                <Tag tone="neutral">{item.route === "invite" ? "invited" : "applied"}</Tag>
              </div>
              <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                {KIND_LABEL[item.kind]} · open until {new Date(item.deadline).toLocaleString()}
              </p>
              {item.mayRaise.ok ? (
                <form action={raiseConcernAction} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="arrivalId" value={item.arrivalId} />
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>A concern about their arrival</span>
                    <textarea name="note" required rows={3} className={INPUT} />
                  </label>
                  <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    A concern holds their arrival until the mediation body has talked it through; a clock never ends it, and nobody is
                    refused by one. You can withdraw it later. You can say this once for each person.
                  </p>
                  <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                    Raise a concern
                  </button>
                </form>
              ) : (
                <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">{item.mayRaise.reason}</p>
              )}
              {item.myStandingConcernId && (
                <form action={withdrawConcernAction} className="mt-2">
                  <input type="hidden" name="concernId" value={item.myStandingConcernId} />
                  <button type="submit" className={BUTTON_SECONDARY}>
                    Withdraw my concern
                  </button>
                </form>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
