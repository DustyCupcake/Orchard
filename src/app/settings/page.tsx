import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getCommunity, listBranches, listTiers, requireAdmins } from "@/lib/settings";
import { listProfileQuestions } from "@/lib/profile-questions";
import { ForbiddenError } from "@/lib/errors";
import Nav from "@/components/Nav";
import {
  archiveProfileQuestionAction,
  createBranchAction,
  createProfileQuestionAction,
  createTierAction,
  deleteBranchAction,
  deleteTierAction,
  unarchiveProfileQuestionAction,
  updateBranchAction,
  updateCommunityAction,
  updateProfileQuestionAction,
  updateTierAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error } = await searchParams;

  let authorized = true;
  try {
    await requireAdmins(currentMember);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      authorized = false;
    } else {
      throw err;
    }
  }

  const [communityRow, branches, tiers, profileQuestions] = await Promise.all([
    getCommunity(currentMember),
    listBranches(currentMember),
    listTiers(currentMember),
    authorized ? listProfileQuestions(currentMember, { includeArchived: true }) : Promise.resolve([]),
  ]);

  if (!authorized) {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
        <Nav memberName={currentMember.name} />
        <h1>Community settings</h1>
        <p style={{ color: "crimson" }}>
          Only a current holder of the &ldquo;{communityRow.adminsTag}&rdquo;-tagged Admins task
          can view or change these — see its detail page to put yourself forward or endorse a
          candidate.
        </p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <Nav memberName={currentMember.name} />
      <h1>Community settings</h1>
      <p style={{ color: "#666" }}>
        {communityRow.adminsEverClaimed
          ? "Editable by whoever currently holds the Admins task."
          : "No Admins task has ever been claimed in this Community yet, so any member can change these — including tagging a community_endorsed task with the Admins tag below to start gating this screen for real."}
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Community</h2>
        <form
          action={updateCommunityAction}
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: 400 }}
        >
          <label>
            Name
            <br />
            <input
              type="text"
              name="name"
              defaultValue={communityRow.name}
              required
              style={{ padding: "0.4rem", width: "100%" }}
            />
          </label>

          <label>
            <input type="checkbox" name="cyclesEnabled" defaultChecked={communityRow.cyclesEnabled} />{" "}
            Cycles on (multiple named production runs over time)
          </label>

          <label>
            <input
              type="checkbox"
              name="phasesEnabled"
              defaultChecked={communityRow.phasesEnabled}
            />{" "}
            Phases on (a cycle can define a named phase spine)
          </label>

          <label>
            Who may start a cycle
            <br />
            <select
              name="cycleInitiationTierId"
              defaultValue={communityRow.cycleInitiationTierId ?? ""}
              style={{ padding: "0.4rem" }}
            >
              <option value="">Any member</option>
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} members only
                </option>
              ))}
            </select>
          </label>

          <label>
            Admins tag
            <br />
            <input
              type="text"
              name="adminsTag"
              defaultValue={communityRow.adminsTag}
              required
              style={{ padding: "0.4rem", width: "100%" }}
            />
            <br />
            <span style={{ fontSize: "0.8rem", color: "#666" }}>
              A community_endorsed task carrying this tag is &ldquo;the&rdquo; Admins task — whoever
              currently holds one gates this screen.
            </span>
          </label>

          <label>
            Coordination tag
            <br />
            <input
              type="text"
              name="coordinationTag"
              defaultValue={communityRow.coordinationTag}
              required
              style={{ padding: "0.4rem", width: "100%" }}
            />
            <br />
            <span style={{ fontSize: "0.8rem", color: "#666" }}>
              Whoever currently holds a task carrying this tag does that task&rsquo;s branch&rsquo;s
              coordination — waiving requirements, seeing escalations and talk-to-coordinator pings
              for that branch.
            </span>
          </label>

          <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
            Save
          </button>
        </form>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Branches</h2>
        {branches.length === 0 && <p style={{ color: "#666" }}>None yet.</p>}
        {branches.map((b) => (
          <div
            key={b.id}
            style={{
              border: "1px solid #ccc",
              borderRadius: 6,
              padding: "0.6rem",
              marginBottom: "0.5rem",
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <form action={updateBranchAction} style={{ display: "flex", gap: "0.5rem", flex: 1 }}>
              <input type="hidden" name="branchId" value={b.id} />
              <input
                type="text"
                name="name"
                defaultValue={b.name}
                style={{ padding: "0.3rem", width: "8rem" }}
              />
              <input
                type="text"
                name="description"
                defaultValue={b.description ?? ""}
                placeholder="description"
                style={{ padding: "0.3rem", flex: 1 }}
              />
              <button type="submit">Save</button>
            </form>
            <form action={deleteBranchAction}>
              <input type="hidden" name="branchId" value={b.id} />
              <button type="submit">Delete</button>
            </form>
          </div>
        ))}

        <form action={createBranchAction} style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <input type="text" name="name" required placeholder="New branch name" style={{ padding: "0.4rem" }} />
          <input
            type="text"
            name="description"
            placeholder="description (optional)"
            style={{ padding: "0.4rem", flex: 1 }}
          />
          <button type="submit">Add branch</button>
        </form>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Tiers</h2>
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          Only manual assignment is functional right now — a member&rsquo;s tiers are set from
          their profile page, not computed automatically.
        </p>
        {tiers.length === 0 && <p style={{ color: "#666" }}>None yet.</p>}
        {tiers.map((t) => (
          <div
            key={t.id}
            style={{
              border: "1px solid #ccc",
              borderRadius: 6,
              padding: "0.6rem",
              marginBottom: "0.5rem",
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <form action={updateTierAction} style={{ display: "flex", gap: "0.5rem", flex: 1 }}>
              <input type="hidden" name="tierId" value={t.id} />
              <input
                type="text"
                name="name"
                defaultValue={t.name}
                style={{ padding: "0.3rem", flex: 1 }}
              />
              <span style={{ fontSize: "0.8rem", color: "#666", alignSelf: "center" }}>
                {t.criterionType}
              </span>
              <button type="submit">Save</button>
            </form>
            <form action={deleteTierAction}>
              <input type="hidden" name="tierId" value={t.id} />
              <button type="submit">Delete</button>
            </form>
          </div>
        ))}

        <form action={createTierAction} style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <input type="text" name="name" required placeholder="New tier name" style={{ padding: "0.4rem" }} />
          <select name="criterionType" defaultValue="manual" style={{ padding: "0.4rem" }}>
            <option value="manual">Manual</option>
            <option value="tenure">Tenure (not yet computed)</option>
            <option value="completion">Completion (not yet computed)</option>
            <option value="cohort">Cohort (not yet computed)</option>
            <option value="cycle_type_count">Cycle-type count (not yet computed)</option>
          </select>
          <button type="submit">Add tier</button>
        </form>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Profile questions</h2>
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          Standing facts about a member — once-ever (e.g. emergency contact), per-cycle, or tied
          to one phase name (e.g. &ldquo;Availability &mdash; Build&rdquo;). A phase-scoped
          question with &ldquo;feeds capacity signal&rdquo; on powers the Coordination view&rsquo;s
          fitted-ask flags and non-response list for whichever cycle phase matches its name.
        </p>
        {profileQuestions.length === 0 && <p style={{ color: "#666" }}>None yet.</p>}
        {profileQuestions.map((q) => (
          <div
            key={q.id}
            style={{
              border: "1px solid #ccc",
              borderRadius: 6,
              padding: "0.6rem",
              marginBottom: "0.5rem",
              opacity: q.archivedAt ? 0.6 : 1,
            }}
          >
            <form
              action={updateProfileQuestionAction}
              style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}
            >
              <input type="hidden" name="questionId" value={q.id} />
              <input
                type="text"
                name="label"
                defaultValue={q.label}
                style={{ padding: "0.3rem", flex: 1, minWidth: "10rem" }}
              />
              <span style={{ fontSize: "0.8rem", color: "#666" }}>
                {q.scope}
                {q.scope === "phase" ? ` (${q.phaseNameHint})` : ""} · {q.responseType}
              </span>
              <label style={{ fontSize: "0.8rem" }}>
                <input type="checkbox" name="required" defaultChecked={q.required} /> required
              </label>
              {q.scope === "phase" && (
                <label style={{ fontSize: "0.8rem" }}>
                  <input
                    type="checkbox"
                    name="feedsCapacitySignal"
                    defaultChecked={q.feedsCapacitySignal}
                  />{" "}
                  feeds capacity signal
                </label>
              )}
              <button type="submit">Save</button>
            </form>
            <form action={q.archivedAt ? unarchiveProfileQuestionAction : archiveProfileQuestionAction} style={{ marginTop: "0.3rem" }}>
              <input type="hidden" name="questionId" value={q.id} />
              <button type="submit">{q.archivedAt ? "Unarchive" : "Archive"}</button>
            </form>
          </div>
        ))}

        <form
          action={createProfileQuestionAction}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem", maxWidth: 400 }}
        >
          <input type="text" name="label" required placeholder="Question label" style={{ padding: "0.4rem" }} />
          <select name="responseType" defaultValue="free_text" style={{ padding: "0.4rem" }}>
            <option value="free_text">Free text</option>
            <option value="single_choice">Single choice</option>
            <option value="multi_choice">Multi choice</option>
          </select>
          <input
            type="text"
            name="options"
            placeholder="options for choice types, comma-separated"
            style={{ padding: "0.4rem" }}
          />
          <select name="scope" defaultValue="once_ever" style={{ padding: "0.4rem" }}>
            <option value="once_ever">Once ever</option>
            <option value="per_cycle">Per cycle</option>
            <option value="phase">Tied to one phase name</option>
          </select>
          <input
            type="text"
            name="phaseNameHint"
            placeholder="phase name (only if scope is 'phase'), e.g. Build"
            style={{ padding: "0.4rem" }}
          />
          <label>
            <input type="checkbox" name="required" /> required
          </label>
          <label>
            <input type="checkbox" name="feedsCapacitySignal" /> feeds capacity signal (phase-scoped
            only)
          </label>
          <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
            Add profile question
          </button>
        </form>
      </section>
    </main>
  );
}
