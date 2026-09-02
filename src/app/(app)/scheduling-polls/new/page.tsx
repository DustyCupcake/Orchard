import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { proposePollAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NewSchedulingPollPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const [branches, members] = await Promise.all([
    db.select().from(branch).where(eq(branch.communityId, currentMember.communityId)),
    db.select().from(member).where(eq(member.communityId, currentMember.communityId)),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 560 }}>
      <h1>Open a scheduling poll</h1>
      <p style={{ color: "#666" }}>
        Members submit their own availability blind — you&rsquo;ll only see the aggregate overlap,
        never who submitted what, until you confirm a slot.
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <form action={proposePollAction} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <label>
          Title
          <br />
          <input type="text" name="title" required style={{ padding: "0.5rem", width: "100%" }} />
        </label>

        <label>
          Branch
          <br />
          <select name="branchId" required style={{ padding: "0.5rem", width: "100%" }}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <legend>Resolution</legend>
          <label>
            <input type="radio" name="resolutionMode" value="max_attendance" defaultChecked /> Maximize
            attendance above a threshold — open to whoever&rsquo;s relevant
          </label>
          <label>
            Minimum attendance to confirm a slot
            <br />
            <input type="number" name="minAttendance" min={1} defaultValue={1} style={{ padding: "0.4rem" }} />
          </label>

          <label>
            <input type="radio" name="resolutionMode" value="must_overlap" /> Must overlap specific people —
            a slot missing any of them isn&rsquo;t an option
          </label>
          <div style={{ paddingLeft: "1.5rem" }}>
            {members.map((m) => (
              <label key={m.id} style={{ display: "block", fontSize: "0.9rem" }}>
                <input type="checkbox" name="requiredParticipantIds" value={m.id} /> {m.name}
              </label>
            ))}
          </div>
        </fieldset>

        <label>
          From
          <br />
          <input type="date" name="rangeStart" required defaultValue={today} style={{ padding: "0.5rem" }} />
        </label>
        <label>
          To
          <br />
          <input type="date" name="rangeEnd" required defaultValue={nextWeek} style={{ padding: "0.5rem" }} />
        </label>

        <fieldset style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <legend>Agenda &amp; summary (each falls back to this branch&rsquo;s, then the Community&rsquo;s, default)</legend>
          <label>
            Open agenda
            <select name="hasAgenda" defaultValue="" style={{ marginLeft: "0.5rem", padding: "0.3rem" }}>
              <option value="">Inherit default</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label>
            Expected summary
            <select name="needsSummary" defaultValue="" style={{ marginLeft: "0.5rem", padding: "0.3rem" }}>
              <option value="">Inherit default</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label>
            Require read-confirmation
            <select name="requireRead" defaultValue="" style={{ marginLeft: "0.5rem", padding: "0.3rem" }}>
              <option value="">Inherit default</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
        </fieldset>

        <button type="submit" style={{ padding: "0.5rem 1rem", width: "fit-content" }}>
          Open poll
        </button>
      </form>
    </main>
  );
}
