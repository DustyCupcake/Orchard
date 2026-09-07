import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  isEventSchedulingOwner,
  listEventProposalsForReview,
  listMyEventProposalPings,
  listMyEventProposals,
  listPublishedSchedule,
} from "@/lib/event-scheduling";
import type { EventSlot } from "@/lib/event-scheduling";
import { resolveDefaultScopeSegment, resolveSingleCycleScope } from "@/lib/cycles";
import { switchToLinkedScopeAction } from "@/app/(app)/cycles/scope-actions";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag } from "@/components/ui/kit";
import { submitEventProposalAction, updateEventProposalAction } from "./actions";
import EventReviewSection from "./EventReviewSection";
import { STATUS_LABEL, STATUS_TONE } from "./status";

export const dynamic = "force-dynamic";

function formatSlot(s: EventSlot) {
  return `${new Date(s.startsAt).toLocaleString()} – ${new Date(s.endsAt).toLocaleTimeString()}`;
}

function formatSlotsRaw(slots: EventSlot[]) {
  return slots.map((s) => `${s.startsAt}|${s.endsAt}`).join("\n");
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

// See docs/spec.md's "Event scheduling" and docs/development-plan.md's
// Phase 28.
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    submitted?: string;
    updated?: string;
    confirmed?: string;
    declined?: string;
    pinged?: string;
    published?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, submitted, updated, confirmed, declined, pinged, published } = await searchParams;

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "event_scheduling");

  // Which cycle's programme to show — the same off-URL resolution the
  // board/task detail page/Spatial planning already read (docs/
  // development-plan.md's Phase 68), replacing the old "no cycle
  // filter at all, every cycle's proposals mixed together" behavior.
  const scopeSegment = await resolveDefaultScopeSegment(viewing);
  const resolution = moduleOn ? await resolveSingleCycleScope(viewing, scopeSegment) : ({ kind: "none" } as const);

  if (moduleOn && resolution.kind === "ambiguous") {
    return (
      <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
        <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Schedule</h1>
        <p className="mt-2 text-[13px] text-[var(--text-muted)]">
          Scoped to multiple active cycles — pick one to see its programme:
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {resolution.candidates.map((c) => (
            <form key={c.id} action={switchToLinkedScopeAction}>
              <input type="hidden" name="scope" value={c.id} />
              <input type="hidden" name="returnTo" value="/schedule" />
              <button type="submit" className={BUTTON_SECONDARY}>
                {c.name}
              </button>
            </form>
          ))}
        </div>
      </main>
    );
  }
  const cycleId = resolution.kind === "resolved" ? resolution.cycle.id : null;

  const isOwner = moduleOn ? await isEventSchedulingOwner(viewing, cycleId) : false;

  const [myProposals, publishedSchedule, reviewProposals] = await Promise.all([
    moduleOn ? listMyEventProposals(viewing, cycleId) : Promise.resolve([]),
    moduleOn ? listPublishedSchedule(viewing, cycleId) : Promise.resolve([]),
    moduleOn && isOwner ? listEventProposalsForReview(viewing, cycleId) : Promise.resolve([]),
  ]);

  const myPingsByProposalId = new Map(
    await Promise.all(
      myProposals
        .filter((p) => p.status === "conflict")
        .map(async (p) => [p.id, await listMyEventProposalPings(viewing, p.id)] as const),
    ),
  );

  const memberIds = [...new Set(reviewProposals.map((p) => p.submittedBy))];
  const memberNameById =
    memberIds.length > 0
      ? new Map(
          (await db.select().from(member).where(eq(member.communityId, viewing.communityId))).map(
            (m) => [m.id, m.name] as const,
          ),
        )
      : new Map<string, string>();

  return (
    <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Schedule</h1>

      {!moduleOn && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          Not turned on for this Community yet — a current Admins holder can enable it under
          Modules on the Settings screen.
        </p>
      )}

      {moduleOn && (
        <>
          {error && (
            <div className="mt-4">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}
          {submitted && (
            <div className="mt-4">
              <Banner tone="success">Proposal submitted.</Banner>
            </div>
          )}
          {updated && (
            <div className="mt-4">
              <Banner tone="success">Proposal updated.</Banner>
            </div>
          )}
          {confirmed && (
            <div className="mt-4">
              <Banner tone="success">Slot confirmed.</Banner>
            </div>
          )}
          {declined && (
            <div className="mt-4">
              <Banner tone="success">Proposal declined.</Banner>
            </div>
          )}
          {pinged && (
            <div className="mt-4">
              <Banner tone="success">Host pinged.</Banner>
            </div>
          )}
          {published && (
            <div className="mt-4">
              <Banner tone="success">Schedule published.</Banner>
            </div>
          )}

          <section className="mt-6">
            <SectionHeading>Published schedule</SectionHeading>
            {publishedSchedule.filter((p) => p.status === "confirmed").length === 0 && (
              <p className="mt-2 text-[13px] text-[var(--text-muted)]">Nothing published yet.</p>
            )}
            <div className="mt-3 flex flex-col gap-2">
              {publishedSchedule
                .filter((p) => p.status === "confirmed")
                .map((p) => {
                  const confirmedSlot = p.confirmedSlot as EventSlot | null;
                  return (
                    <div key={p.id} className={CARD}>
                      <p className="text-[14px] font-medium text-[var(--text)]">
                        {p.title} <span className="font-normal text-[var(--text-muted)]">— hosted by {p.host}</span>
                      </p>
                      <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                        {confirmedSlot && formatSlot(confirmedSlot)}
                        {p.spaceNeeds && <> · {p.spaceNeeds}</>}
                      </p>
                      {p.description && <p className="mt-1 text-[13px] text-[var(--text)]">{p.description}</p>}
                    </div>
                  );
                })}
            </div>
          </section>

          <section className="mt-8">
            <SectionHeading>My proposals</SectionHeading>
            {myProposals.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">None yet.</p>}
            <div className="mt-3 flex flex-col gap-3">
              {myProposals.map((p) => {
                const editable = !p.publishedAt && (p.status === "proposed" || p.status === "conflict");
                const pings = myPingsByProposalId.get(p.id) ?? [];
                const confirmedSlot = p.confirmedSlot as EventSlot | null;
                return (
                  <div key={p.id} className={CARD}>
                    <Tag tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status] ?? p.status}</Tag>
                    <p className="mt-1.5 text-[14px] font-medium text-[var(--text)]">
                      {p.title} <span className="font-normal text-[var(--text-muted)]">— hosted by {p.host}</span>
                    </p>
                    {p.description && <p className="mt-1 text-[13px] text-[var(--text)]">{p.description}</p>}
                    <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                      {p.durationMinutes} min{p.spaceNeeds && <> · {p.spaceNeeds}</>}
                    </p>
                    <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-[var(--text-muted)]">
                      {(p.preferredSlots as EventSlot[]).map((s, i) => (
                        <li key={i}>{formatSlot(s)}</li>
                      ))}
                    </ul>
                    {confirmedSlot && (
                      <p className="mt-1.5 text-[13px] text-[var(--text)]">Confirmed: {formatSlot(confirmedSlot)}</p>
                    )}
                    {pings.length > 0 && (
                      <p className="mt-1.5 text-[13px] text-[var(--warning)]">
                        The scheduling owner has flagged this conflict {pings.length} time(s) — propose a
                        different slot, or reach out to sort it out directly.
                      </p>
                    )}

                    {editable && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">Edit</summary>
                        <form action={updateEventProposalAction} className="mt-2 flex max-w-md flex-col gap-2">
                          <input type="hidden" name="proposalId" value={p.id} />
                          <label className="flex flex-col gap-1">
                            <span className={LABEL}>Host</span>
                            <input type="text" name="host" defaultValue={p.host} required className={INPUT} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className={LABEL}>Title</span>
                            <input type="text" name="title" defaultValue={p.title} required className={INPUT} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className={LABEL}>Description</span>
                            <textarea name="description" defaultValue={p.description ?? ""} rows={2} className={INPUT} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className={LABEL}>Duration (minutes)</span>
                            <input
                              type="number"
                              name="durationMinutes"
                              defaultValue={p.durationMinutes}
                              min={1}
                              required
                              className={INPUT}
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className={LABEL}>Space needed (optional)</span>
                            <input type="text" name="spaceNeeds" defaultValue={p.spaceNeeds ?? ""} className={INPUT} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className={LABEL}>Preferred slots — one per line, startsAt|endsAt</span>
                            <textarea
                              name="preferredSlotsRaw"
                              defaultValue={formatSlotsRaw(p.preferredSlots as EventSlot[])}
                              rows={3}
                              className={`${INPUT} font-mono`}
                            />
                          </label>
                          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                            Save changes
                          </button>
                        </form>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>

            <h3 className="mt-6 text-[15px] font-medium text-[var(--text)]">Submit a proposal</h3>
            <form action={submitEventProposalAction} className="mt-2 flex max-w-[500px] flex-col gap-2">
              <input type="hidden" name="cycleId" value={cycleId ?? ""} />
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Host</span>
                <input type="text" name="host" required className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Title</span>
                <input type="text" name="title" required className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Description</span>
                <textarea name="description" rows={2} className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Duration (minutes)</span>
                <input type="number" name="durationMinutes" min={1} required className={`${INPUT} w-fit`} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Space needed (optional)</span>
                <input type="text" name="spaceNeeds" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Preferred slots — one per line, startsAt|endsAt</span>
                <textarea
                  name="preferredSlotsRaw"
                  rows={4}
                  required
                  placeholder={"2026-09-10T14:00|2026-09-10T15:30\n2026-09-11T09:00|2026-09-11T10:30"}
                  className={`${INPUT} font-mono`}
                />
              </label>
              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                Submit proposal
              </button>
            </form>
          </section>

          {isOwner && (
            <EventReviewSection proposals={reviewProposals} memberNameById={memberNameById} cycleId={cycleId} />
          )}
        </>
      )}
    </main>
  );
}
