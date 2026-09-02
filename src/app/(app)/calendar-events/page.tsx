import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import {
  getCalendarEvent,
  listCalendarEventInvites,
  listMyCalendarEventInvites,
  listMyCalendarEvents,
} from "@/lib/calendar-events";
import { listBranches } from "@/lib/settings";
import { listCycles } from "@/lib/cycles";
import {
  acceptInviteAction,
  createCalendarEventAction,
  declineInviteAction,
  deleteCalendarEventAction,
  inviteBranchAction,
  inviteCommunityAction,
  inviteMemberAction,
  updateCalendarEventAction,
} from "./actions";

export const dynamic = "force-dynamic";

const SHARE_LABEL: Record<string, string> = {
  personal: "Personal (just you)",
  branch: "Shared with a Branch",
  community: "Shared with the whole Community",
};

// A member's own events, plus responding to pending invites — see
// docs/development-plan.md's Phase 42, whose own scope note says this
// "folds into the Calendar view, Phase 43, rather than a separate
// page." Built as a plain page now anyway, since "any member can
// create an event... share it... accept/decline it" (this phase's own
// Done-when bar) needs somewhere real to happen before Phase 43's
// unified read view exists — expect this content to move into
// `/calendar` once that phase lands, not to stay here permanently.
export default async function CalendarEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; updated?: string; deleted?: string; invited?: string; responded?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error, created, updated, deleted, invited, responded } = await searchParams;

  const [myEvents, myInvites, branches, cycles, communityMembers] = await Promise.all([
    listMyCalendarEvents(currentMember),
    listMyCalendarEventInvites(currentMember),
    listBranches(currentMember),
    listCycles(currentMember),
    db.select().from(member).where(eq(member.communityId, currentMember.communityId)),
  ]);

  const myOwnEvents = myEvents.filter((e) => e.memberId === currentMember.id);
  const acceptedEvents = myEvents.filter((e) => e.memberId !== currentMember.id);

  const inviteListsByEventId = new Map(
    await Promise.all(
      myOwnEvents.map(async (e) => [e.id, await listCalendarEventInvites(currentMember, e.id)] as const),
    ),
  );

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 720 }}>
      <h1>Calendar events</h1>
      <p style={{ color: "#666", fontSize: "0.85rem" }}>
        A personal or shared calendar entry that isn&rsquo;t about any one task. Always exactly one
        owner, its creator — no approval step for creating or sharing one.
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {created && <p style={{ color: "#2a7a2a" }}>Event created.</p>}
      {updated && <p style={{ color: "#2a7a2a" }}>Event updated.</p>}
      {deleted && <p style={{ color: "#2a7a2a" }}>Event deleted.</p>}
      {invited && <p style={{ color: "#2a7a2a" }}>Invites sent.</p>}
      {responded && <p style={{ color: "#2a7a2a" }}>Your response is saved.</p>}

      {myInvites.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Invites waiting on you</h2>
          {myInvites.map((i) => (
            <div
              key={i.eventId}
              style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
            >
              <strong>{i.eventTitle}</strong>{" "}
              <span style={{ color: "#666" }}>
                — invited by {i.invitedByName}, {new Date(i.invitedAt).toLocaleDateString()}
              </span>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
                <form action={acceptInviteAction}>
                  <input type="hidden" name="eventId" value={i.eventId} />
                  <button type="submit">Accept</button>
                </form>
                <form action={declineInviteAction}>
                  <input type="hidden" name="eventId" value={i.eventId} />
                  <button type="submit">Decline</button>
                </form>
              </div>
            </div>
          ))}
        </section>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Your events</h2>
        {myOwnEvents.length === 0 && <p style={{ color: "#666" }}>None yet.</p>}
        {myOwnEvents.map((e) => {
          const eventInvites = inviteListsByEventId.get(e.id) ?? [];
          return (
            <div
              key={e.id}
              style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.75rem" }}
            >
              <strong>{e.title}</strong> <span style={{ color: "#666" }}>({SHARE_LABEL[e.shareTarget]})</span>
              <div style={{ fontSize: "0.85rem", color: "#666" }}>
                {e.date ?? "unresolved"}
                {e.drifted && <span style={{ color: "#b8860b" }}> · drifted from its anchor</span>}
              </div>
              {e.description && <p style={{ margin: "0.3rem 0" }}>{e.description}</p>}

              {eventInvites.length > 0 && (
                <p style={{ fontSize: "0.8rem", color: "#666" }}>
                  Invited: {eventInvites.map((i) => `${i.memberName} (${i.invite.status})`).join(", ")}
                </p>
              )}

              <details style={{ marginTop: "0.4rem" }}>
                <summary>Edit</summary>
                <form
                  action={updateCalendarEventAction}
                  style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxWidth: 420, marginTop: "0.4rem" }}
                >
                  <input type="hidden" name="eventId" value={e.id} />
                  <input type="text" name="title" required defaultValue={e.title} style={{ padding: "0.4rem" }} />
                  <textarea name="description" rows={2} defaultValue={e.description ?? ""} style={{ padding: "0.4rem" }} />
                  <select name="cycleId" defaultValue={e.cycleId ?? ""} style={{ padding: "0.4rem" }}>
                    <option value="">Cycle-independent</option>
                    {cycles.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <EventDateFields event={e} />
                  <select name="shareTarget" defaultValue={e.shareTarget} style={{ padding: "0.4rem" }}>
                    <option value="personal">Personal (just you)</option>
                    <option value="branch">Shared with a Branch</option>
                    <option value="community">Shared with the whole Community</option>
                  </select>
                  <select name="sharedBranchId" defaultValue={e.sharedBranchId ?? ""} style={{ padding: "0.4rem" }}>
                    <option value="">— pick a Branch if shareTarget is Branch —</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" style={{ width: "fit-content" }}>
                    Save
                  </button>
                </form>
              </details>

              <details style={{ marginTop: "0.4rem" }}>
                <summary>Invite people</summary>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.4rem" }}>
                  <form action={inviteMemberAction} style={{ display: "flex", gap: "0.5rem" }}>
                    <input type="hidden" name="eventId" value={e.id} />
                    <select name="memberId" required style={{ padding: "0.3rem" }}>
                      <option value="">Pick a member</option>
                      {communityMembers
                        .filter((m) => m.id !== currentMember.id)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                    <button type="submit">Invite</button>
                  </form>
                  <form action={inviteBranchAction} style={{ display: "flex", gap: "0.5rem" }}>
                    <input type="hidden" name="eventId" value={e.id} />
                    <select name="branchId" required style={{ padding: "0.3rem" }}>
                      <option value="">Pick a Branch</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <button type="submit">Invite Branch&rsquo;s current roster</button>
                  </form>
                  <form action={inviteCommunityAction}>
                    <input type="hidden" name="eventId" value={e.id} />
                    <button type="submit">Invite the whole Community</button>
                  </form>
                </div>
              </details>

              <form action={deleteCalendarEventAction} style={{ marginTop: "0.4rem" }}>
                <input type="hidden" name="eventId" value={e.id} />
                <button type="submit">Delete</button>
              </form>
            </div>
          );
        })}
      </section>

      {acceptedEvents.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>On your calendar</h2>
          {acceptedEvents.map((e) => (
            <div key={e.id} style={{ marginBottom: "0.5rem" }}>
              <strong>{e.title}</strong> <span style={{ color: "#666" }}>— {e.date ?? "unresolved"}</span>
            </div>
          ))}
        </section>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Create an event</h2>
        <form
          action={createCalendarEventAction}
          style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxWidth: 420 }}
        >
          <input type="text" name="title" required placeholder="Title" style={{ padding: "0.4rem" }} />
          <textarea name="description" rows={2} placeholder="Description (optional)" style={{ padding: "0.4rem" }} />
          <select name="cycleId" defaultValue="" style={{ padding: "0.4rem" }}>
            <option value="">Cycle-independent</option>
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <EventDateFields />
          <select name="shareTarget" defaultValue="personal" style={{ padding: "0.4rem" }}>
            <option value="personal">Personal (just you)</option>
            <option value="branch">Shared with a Branch</option>
            <option value="community">Shared with the whole Community</option>
          </select>
          <select name="sharedBranchId" defaultValue="" style={{ padding: "0.4rem" }}>
            <option value="">— pick a Branch if shareTarget is Branch —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button type="submit" style={{ width: "fit-content" }}>
            Create
          </button>
        </form>
      </section>
    </main>
  );
}

type EventRow = Awaited<ReturnType<typeof listMyCalendarEvents>>[number] | Awaited<ReturnType<typeof getCalendarEvent>>;

// A single date, not a start/end pair — see src/app/participation/
// page.tsx's PhaseBoundaryFields for the two-boundary sibling of this,
// and src/lib/dates/resolve.ts's dateBoundaryInput for the shared
// shape both forms submit.
function EventDateFields({ event }: { event?: EventRow }) {
  const mode = !event || event.dateType === "absolute" ? "absolute" : `relative_${event.relativeMode}`;

  return (
    <fieldset style={{ border: "1px solid #eee", borderRadius: 4, padding: "0.5rem" }}>
      <legend style={{ fontSize: "0.85rem" }}>When</legend>
      <label>
        Mode
        <br />
        <select name="dateMode" defaultValue={mode} style={{ padding: "0.4rem", width: "100%" }}>
          <option value="absolute">Absolute date</option>
          <option value="relative_offset">Relative — offset (days from the Cycle&rsquo;s start/end)</option>
          <option value="relative_percent">Relative — percent (between the Cycle&rsquo;s start and end)</option>
        </select>
      </label>
      <label>
        Absolute date (used when mode is Absolute)
        <br />
        <input
          type="date"
          name="absoluteDate"
          defaultValue={event?.dateType === "absolute" ? (event.date ?? "") : ""}
          style={{ padding: "0.4rem" }}
        />
      </label>
      <label>
        Anchor (used when mode is relative offset)
        <br />
        <select name="anchor" defaultValue={event?.anchorType ?? "cycle_start"} style={{ padding: "0.4rem" }}>
          <option value="cycle_start">Cycle start</option>
          <option value="cycle_end">Cycle end</option>
        </select>
      </label>
      <label>
        Offset days (used when mode is relative offset, and no target date is given below)
        <br />
        <input
          type="number"
          name="offsetDays"
          defaultValue={event?.relativeMode === "offset" ? (event.offsetDays ?? "") : ""}
          style={{ padding: "0.4rem" }}
        />
      </label>
      <label>
        Percent 0-100 (used when mode is relative percent, and no target date is given below)
        <br />
        <input
          type="number"
          min={0}
          max={100}
          name="percent"
          defaultValue={event?.relativeMode === "percent" ? (event.percent ?? "") : ""}
          style={{ padding: "0.4rem" }}
        />
      </label>
      <label>
        Or drag to this target date (recomputes and persists the offset/percent above)
        <br />
        <input type="date" name="targetDate" style={{ padding: "0.4rem" }} />
      </label>
    </fieldset>
  );
}
