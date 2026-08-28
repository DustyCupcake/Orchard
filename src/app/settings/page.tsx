import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { task } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { getCommunity, listBranches, listTiers, requireAdmins } from "@/lib/settings";
import { listProfileQuestions } from "@/lib/profile-questions";
import { MODULE_DEFINITIONS } from "@/lib/modules";
import { SENSITIVE_FIELD_KEYS, SENSITIVE_FIELD_LABELS, listSensitiveFieldAccessRules } from "@/lib/sensitive-data";
import { ForbiddenError } from "@/lib/errors";
import Nav from "@/components/Nav";
import {
  archiveProfileQuestionAction,
  createBranchAction,
  createProfileQuestionAction,
  createSensitiveFieldAccessRuleAction,
  createTierAction,
  deleteBranchAction,
  deleteSensitiveFieldAccessRuleAction,
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

  const [communityRow, branches, tiers, profileQuestions, sensitiveFieldRules] = await Promise.all([
    getCommunity(currentMember),
    listBranches(currentMember),
    listTiers(currentMember),
    authorized ? listProfileQuestions(currentMember, { includeArchived: true }) : Promise.resolve([]),
    authorized ? listSensitiveFieldAccessRules(currentMember) : Promise.resolve([]),
  ]);

  const conflictTeamTask = communityRow.conflictTeamTaskId
    ? await db
        .select({ id: task.id, title: task.title })
        .from(task)
        .where(eq(task.id, communityRow.conflictTeamTaskId))
        .then((r) => r[0])
    : null;

  const ruleTaskIds = [
    ...new Set(sensitiveFieldRules.map((r) => r.unlockedByTaskId).filter((id): id is string => Boolean(id))),
  ];
  const ruleTasks =
    ruleTaskIds.length > 0
      ? await db.select({ id: task.id, title: task.title }).from(task).where(inArray(task.id, ruleTaskIds))
      : [];
  const ruleTaskNameById = new Map(ruleTasks.map((t) => [t.id, t.title]));
  const tierNameById = new Map(tiers.map((t) => [t.id, t.name]));

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

          <fieldset>
            <legend>Call defaults (a Branch&rsquo;s own default overrides these — see below)</legend>
            <label style={{ display: "block" }}>
              <input
                type="checkbox"
                name="defaultCallHasAgenda"
                defaultChecked={communityRow.defaultCallHasAgenda}
              />{" "}
              Open agenda
            </label>
            <label style={{ display: "block" }}>
              <input
                type="checkbox"
                name="defaultCallNeedsSummary"
                defaultChecked={communityRow.defaultCallNeedsSummary}
              />{" "}
              Expected summary
            </label>
            <label style={{ display: "block" }}>
              <input
                type="checkbox"
                name="defaultCallRequireRead"
                defaultChecked={communityRow.defaultCallRequireRead}
              />{" "}
              Require read-confirmation
            </label>
          </fieldset>

          <label>
            Conflict team task ID (leave blank to keep Conflict management off)
            <br />
            <input
              type="text"
              name="conflictTeamTaskId"
              defaultValue={communityRow.conflictTeamTaskId ?? ""}
              placeholder="paste the task's ID from its /tasks/… URL"
              style={{ padding: "0.4rem", width: "100%" }}
            />
            <br />
            <span style={{ fontSize: "0.8rem", color: "#666" }}>
              {conflictTeamTask
                ? `Currently: "${conflictTeamTask.title}" — whoever holds it is the conflict team.`
                : "A critical, multi-slot coordination task like any other — whoever holds it becomes the conflict team."}
            </span>
          </label>

          <label>
            Acknowledgment window (hours)
            <br />
            <input
              type="number"
              name="conflictAckWindowHours"
              min={1}
              defaultValue={communityRow.conflictAckWindowHours}
              style={{ padding: "0.4rem", width: "8rem" }}
            />
          </label>

          <fieldset>
            <legend>Modules</legend>
            {MODULE_DEFINITIONS.map((m) => (
              <label key={m.key} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  name="modulesEnabled"
                  value={m.key}
                  defaultChecked={communityRow.modulesEnabled.includes(m.key)}
                />{" "}
                {m.label}
              </label>
            ))}
          </fieldset>

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
            <form
              action={updateBranchAction}
              style={{ display: "flex", gap: "0.5rem", flex: 1, flexWrap: "wrap", alignItems: "center" }}
            >
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
              {(
                [
                  ["defaultCallHasAgenda", "Agenda", b.defaultCallHasAgenda],
                  ["defaultCallNeedsSummary", "Summary", b.defaultCallNeedsSummary],
                  ["defaultCallRequireRead", "Read-confirm", b.defaultCallRequireRead],
                ] as const
              ).map(([name, label, value]) => (
                <label key={name} style={{ fontSize: "0.8rem" }}>
                  {label}
                  <select
                    name={name}
                    defaultValue={value === null ? "inherit" : value ? "on" : "off"}
                    style={{ marginLeft: "0.3rem", padding: "0.2rem" }}
                  >
                    <option value="inherit">Inherit</option>
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </label>
              ))}
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

      <section style={{ marginTop: "2rem" }}>
        <h2>Sensitive data access</h2>
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          Purpose-bound, not role-bound: pick which task or tier unlocks each field for{" "}
          <em>other</em> members&rsquo; values on <code>/sensitive-data</code>. A member can always
          see and edit their own values regardless of these rules. Only takes effect once
          &ldquo;Sensitive data&rdquo; is checked under Modules above.
        </p>
        {sensitiveFieldRules.length === 0 && <p style={{ color: "#666" }}>No rules yet.</p>}
        {sensitiveFieldRules.map((r) => (
          <div
            key={r.id}
            style={{
              border: "1px solid #ccc",
              borderRadius: 6,
              padding: "0.6rem",
              marginBottom: "0.5rem",
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
            }}
          >
            <span style={{ flex: 1 }}>
              {SENSITIVE_FIELD_LABELS[r.fieldKey]} — unlocked by{" "}
              {r.unlockedByTaskId
                ? `holding "${ruleTaskNameById.get(r.unlockedByTaskId) ?? "—"}"`
                : `Tier "${tierNameById.get(r.unlockedByTierId!) ?? "—"}"`}
            </span>
            <form action={deleteSensitiveFieldAccessRuleAction}>
              <input type="hidden" name="ruleId" value={r.id} />
              <button type="submit">Delete</button>
            </form>
          </div>
        ))}

        <form
          action={createSensitiveFieldAccessRuleAction}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem", maxWidth: 420 }}
        >
          <select name="fieldKey" defaultValue={SENSITIVE_FIELD_KEYS[0]} style={{ padding: "0.4rem" }}>
            {SENSITIVE_FIELD_KEYS.map((k) => (
              <option key={k} value={k}>
                {SENSITIVE_FIELD_LABELS[k]}
              </option>
            ))}
          </select>
          <label style={{ fontSize: "0.85rem" }}>
            Unlock via a Tier
            <select name="unlockedByTierId" defaultValue="" style={{ padding: "0.4rem", width: "100%" }}>
              <option value="">— none —</option>
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "0.85rem" }}>
            Or unlock via a Task ID (pick exactly one of Tier/Task)
            <input
              type="text"
              name="unlockedByTaskId"
              placeholder="paste the task's ID from its /tasks/… URL"
              style={{ padding: "0.4rem", width: "100%" }}
            />
          </label>
          <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
            Add rule
          </button>
        </form>
      </section>
    </main>
  );
}
