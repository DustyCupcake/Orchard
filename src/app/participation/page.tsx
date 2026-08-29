import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getCurrentCycle } from "@/lib/profile-questions";
import { canInitiateCycle } from "@/lib/cycles";
import { getCycleParticipationSummary, getMyParticipation } from "@/lib/participation";
import type { member as memberTable } from "@/db/schema";
import Nav from "@/components/Nav";
import { declareParticipationAction, updateCycleSettingsAction } from "./actions";

type Member = typeof memberTable.$inferSelect;

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  unknown: "Haven't said",
  coming: "Coming",
  maybe: "Maybe",
  not_coming: "Not coming",
};

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not a full
// ISO string with a timezone offset — same helper src/app/schedule's
// EventReviewSection.tsx already uses.
function toDatetimeLocal(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// "Who's actually planning to be there, and how much room is left" —
// see docs/spec.md's "Participation & capacity" under Cycle and
// docs/development-plan.md's Phase 31. Core, not gated behind
// Recruitment — a Community with cycles on always has this page,
// whether or not Recruitment ever gets turned on.
export default async function ParticipationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; declared?: string; settingsUpdated?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error, declared, settingsUpdated } = await searchParams;

  const currentCycle = await getCurrentCycle(currentMember.communityId);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <Nav memberName={currentMember.name} />
      <h1>Participation</h1>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {declared && <p style={{ color: "#2a7a2a" }}>Your participation is saved.</p>}
      {settingsUpdated && <p style={{ color: "#2a7a2a" }}>Cycle settings updated.</p>}

      {!currentCycle ? (
        <p style={{ color: "#666" }}>
          No current cycle yet — there&rsquo;s nothing to declare participation against until one
          exists.
        </p>
      ) : (
        <ParticipationForCycle
          currentMember={currentMember}
          cycleId={currentCycle.id}
          cycleName={currentCycle.name}
        />
      )}
    </main>
  );
}

async function ParticipationForCycle({
  currentMember,
  cycleId,
  cycleName,
}: {
  currentMember: Member;
  cycleId: string;
  cycleName: string;
}) {
  const [summary, mine, canConfigure] = await Promise.all([
    getCycleParticipationSummary(currentMember, cycleId),
    getMyParticipation(currentMember, cycleId),
    canInitiateCycle(currentMember),
  ]);

  return (
    <>
      <section style={{ marginTop: "1rem" }}>
        <h2>{cycleName}</h2>
        <p style={{ color: "#666" }}>
          {summary.capacity === null ? (
            "No capacity cap set — unlimited."
          ) : (
            <>
              Capacity {summary.capacity} · {summary.comingCount} coming ·{" "}
              {summary.remainingCapacity !== null && summary.remainingCapacity < 0
                ? `${-summary.remainingCapacity} over capacity`
                : `${summary.remainingCapacity} remaining`}
            </>
          )}
        </p>
        {summary.returningWindowClosesAt && (
          <p style={{ color: summary.returningWindowOpen ? "#2a7a2a" : "#666" }}>
            Returning-priority window {summary.returningWindowOpen ? "open" : "closed"} — closes{" "}
            {new Date(summary.returningWindowClosesAt).toLocaleString()}.
          </p>
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Your plans</h2>
        <form
          action={declareParticipationAction}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 400 }}
        >
          <input type="hidden" name="cycleId" value={cycleId} />
          <label>
            Status
            <br />
            <select name="status" defaultValue={mine.status} style={{ padding: "0.4rem", width: "100%" }}>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Arrival date (optional)
            <br />
            <input
              type="date"
              name="arrivalDate"
              defaultValue={mine.arrivalDate ?? ""}
              style={{ padding: "0.4rem" }}
            />
          </label>
          <label>
            Departure date (optional)
            <br />
            <input
              type="date"
              name="departureDate"
              defaultValue={mine.departureDate ?? ""}
              style={{ padding: "0.4rem" }}
            />
          </label>
          <label>
            Note (optional)
            <br />
            <textarea name="note" rows={2} defaultValue={mine.note ?? ""} style={{ padding: "0.4rem", width: "100%" }} />
          </label>
          <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
            Save
          </button>
        </form>
      </section>

      {canConfigure && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Cycle settings</h2>
          <p style={{ color: "#666", fontSize: "0.85rem" }}>
            Visible to you because you can start a cycle for this Community — the same authority
            configures its capacity and returning-priority window.
          </p>
          <form
            action={updateCycleSettingsAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 400 }}
          >
            <input type="hidden" name="cycleId" value={cycleId} />
            <label>
              Capacity (optional — blank = unlimited)
              <br />
              <input
                type="number"
                name="capacity"
                min={1}
                defaultValue={summary.capacity ?? ""}
                style={{ padding: "0.4rem" }}
              />
            </label>
            <label>
              Returning-priority window closes at (optional)
              <br />
              <input
                type="datetime-local"
                name="returningWindowClosesAt"
                defaultValue={
                  summary.returningWindowClosesAt ? toDatetimeLocal(new Date(summary.returningWindowClosesAt)) : ""
                }
                style={{ padding: "0.4rem" }}
              />
            </label>
            <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
              Save settings
            </button>
          </form>
        </section>
      )}
    </>
  );
}
