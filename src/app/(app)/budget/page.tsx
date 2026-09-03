import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member, task } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity, listBranches, requireAdmins } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { getBudgetVotingView, getCurrentBudgetCycle, isBudgetOwner, listBudgetProposals } from "@/lib/budget";
import type { BudgetLineItem } from "@/lib/budget";
import { ForbiddenError } from "@/lib/errors";
import {
  closeProposalsToVotingAction,
  createBudgetCycleAction,
  submitBudgetProposalAction,
  updateBudgetProposalAction,
} from "./actions";
import BudgetVotingSection from "./BudgetVotingSection";

export const dynamic = "force-dynamic";

function formatAmount(n: number) {
  return n.toLocaleString();
}

function formatLineItems(items: BudgetLineItem[]) {
  return items.map((i) => `${i.label}|${i.amount}`).join("\n");
}

const STATUS_LABEL: Record<string, string> = {
  proposals_open: "Proposals open",
  voting: "Voting",
  confirmed: "Confirmed",
};

// See docs/spec.md's Budget and docs/development-plan.md's Phases
// 26-27: fixed costs & proposals while `proposals_open`, ranked-choice
// voting and owner confirmation once the owner closes proposals.
export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    submitted?: string;
    updated?: string;
    votingOpened?: string;
    voted?: string;
    confirmed?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, submitted, updated, votingOpened, voted, confirmed } = await searchParams;

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "budget");

  let isAdmin = false;
  try {
    await requireAdmins(viewing);
    isAdmin = true;
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  const currentCycle = moduleOn ? await getCurrentBudgetCycle(viewing) : null;
  const canStartNewCycle = moduleOn && (!currentCycle || currentCycle.status === "confirmed");
  const isOwner = currentCycle ? await isBudgetOwner(viewing, currentCycle) : false;

  const [branches, proposals, votingView] = await Promise.all([
    moduleOn ? listBranches(viewing) : Promise.resolve([]),
    currentCycle && currentCycle.status === "proposals_open"
      ? listBudgetProposals(viewing, currentCycle.id)
      : Promise.resolve([]),
    currentCycle && currentCycle.status !== "proposals_open"
      ? getBudgetVotingView(viewing, currentCycle.id)
      : Promise.resolve(null),
  ]);
  const branchNameById = new Map(branches.map((b) => [b.id, b.name] as const));

  const ownerTask = currentCycle
    ? await db
        .select({ id: task.id, title: task.title })
        .from(task)
        .where(eq(task.id, currentCycle.ownerTaskId))
        .then((r) => r[0])
    : null;

  const memberNameById = currentCycle
    ? new Map(
        (await db.select().from(member).where(eq(member.communityId, viewing.communityId))).map(
          (m) => [m.id, m.name] as const,
        ),
      )
    : new Map<string, string>();

  const fixedCosts = (currentCycle?.fixedCosts as BudgetLineItem[] | undefined) ?? [];
  const fixedTotal = fixedCosts.reduce((sum, i) => sum + i.amount, 0);
  const proposalsTotal = proposals.reduce((sum, p) => sum + p.totalAmount, 0);
  const confirmedIds = new Set((currentCycle?.confirmedProposalIds as string[] | null) ?? []);
  const myContributionSignal =
    votingView?.myVote?.contributionSignal !== undefined ? votingView?.myVote?.contributionSignal : null;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 720 }}>
      <h1>Budget</h1>

      {!moduleOn && (
        <p style={{ color: "#666" }}>
          Not turned on for this Community yet — a current Admins holder can enable it under
          Modules on the Settings screen.
        </p>
      )}

      {moduleOn && (
        <>
          {error && <p style={{ color: "crimson" }}>{error}</p>}
          {submitted && <p style={{ color: "#2a7a2a" }}>Proposal submitted.</p>}
          {updated && <p style={{ color: "#2a7a2a" }}>Proposal updated.</p>}
          {votingOpened && <p style={{ color: "#2a7a2a" }}>Proposals closed — voting is open.</p>}
          {voted && <p style={{ color: "#2a7a2a" }}>Your vote was recorded.</p>}
          {confirmed && <p style={{ color: "#2a7a2a" }}>Budget confirmed.</p>}

          {currentCycle && (
            <section style={{ marginTop: "1rem" }}>
              <h2>{currentCycle.title}</h2>
              <p style={{ color: "#666" }}>
                {STATUS_LABEL[currentCycle.status] ?? currentCycle.status} · proposal deadline{" "}
                {new Date(currentCycle.proposalDeadline).toLocaleString()}
                <br />
                Owner task: {ownerTask ? `"${ownerTask.title}"` : "—"} — whoever holds it is the
                budget owner.
              </p>

              <h3>Fixed costs {fixedCosts.length > 0 && <>({formatAmount(fixedTotal)} total)</>}</h3>
              {fixedCosts.length === 0 && <p style={{ color: "#666" }}>None entered.</p>}
              {fixedCosts.length > 0 && (
                <ul>
                  {fixedCosts.map((c, i) => (
                    <li key={i}>
                      {c.label}: {formatAmount(c.amount)}
                    </li>
                  ))}
                </ul>
              )}

              {currentCycle.status === "proposals_open" && (
              <>
              <h3>
                Proposals ({proposals.length}
                {proposals.length > 0 && <>, {formatAmount(proposalsTotal)} total</>})
              </h3>
              {proposals.length === 0 && <p style={{ color: "#666" }}>None yet.</p>}
              {proposals.map((p) => {
                const items = p.lineItems as BudgetLineItem[];
                const mine = p.submittedBy === viewing.id;
                return (
                  <div
                    key={p.id}
                    style={{
                      border: "1px solid #ccc",
                      borderRadius: 6,
                      padding: "0.6rem",
                      marginBottom: "0.6rem",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: "0.8rem", color: "#666" }}>
                      {memberNameById.get(p.submittedBy) ?? "—"}
                      {p.branchId && <> · {branchNameById.get(p.branchId) ?? "—"}</>} ·{" "}
                      {formatAmount(p.totalAmount)} total
                    </p>
                    <strong>{p.title}</strong>
                    {p.description && <p style={{ margin: "0.2rem 0" }}>{p.description}</p>}
                    <ul style={{ margin: "0.3rem 0 0" }}>
                      {items.map((it, i) => (
                        <li key={i}>
                          {it.label}: {formatAmount(it.amount)}
                        </li>
                      ))}
                    </ul>

                    {mine && currentCycle.status === "proposals_open" && (
                      <details style={{ marginTop: "0.5rem" }}>
                        <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>Edit</summary>
                        <form
                          action={updateBudgetProposalAction}
                          style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.4rem" }}
                        >
                          <input type="hidden" name="proposalId" value={p.id} />
                          <input
                            type="text"
                            name="title"
                            defaultValue={p.title}
                            required
                            style={{ padding: "0.4rem" }}
                          />
                          <textarea
                            name="description"
                            defaultValue={p.description ?? ""}
                            rows={2}
                            style={{ padding: "0.4rem" }}
                          />
                          <select
                            name="branchId"
                            defaultValue={p.branchId ?? ""}
                            style={{ padding: "0.4rem" }}
                          >
                            <option value="">No branch</option>
                            {branches.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                          <textarea
                            name="lineItemsRaw"
                            defaultValue={formatLineItems(items)}
                            rows={3}
                            placeholder="label|amount, one per line"
                            style={{ padding: "0.4rem", fontFamily: "monospace" }}
                          />
                          <button type="submit" style={{ padding: "0.3rem 0.8rem", width: "fit-content" }}>
                            Save changes
                          </button>
                        </form>
                      </details>
                    )}
                  </div>
                );
              })}

              <h3>Submit a proposal</h3>
              <form
                action={submitBudgetProposalAction}
                style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 500 }}
              >
                <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
                <label>
                  Title
                  <br />
                  <input type="text" name="title" required style={{ padding: "0.4rem", width: "100%" }} />
                </label>
                <label>
                  Description
                  <br />
                  <textarea name="description" rows={2} style={{ padding: "0.4rem", width: "100%" }} />
                </label>
                <label>
                  Branch (optional)
                  <br />
                  <select name="branchId" defaultValue="" style={{ padding: "0.4rem", width: "100%" }}>
                    <option value="">No branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Line items — one per line, <code>label|amount</code>
                  <br />
                  <textarea
                    name="lineItemsRaw"
                    rows={4}
                    required
                    placeholder={"Portable toilets|450\nSignage|120"}
                    style={{ padding: "0.4rem", width: "100%", fontFamily: "monospace" }}
                  />
                </label>
                <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
                  Submit proposal
                </button>
              </form>

              {isOwner && (
                <form action={closeProposalsToVotingAction} style={{ marginTop: "1.5rem" }}>
                  <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
                  <button type="submit" style={{ padding: "0.4rem 1rem" }}>
                    Close proposals — open voting
                  </button>
                </form>
              )}
              </>
              )}

              {currentCycle.status !== "proposals_open" && votingView && (
                <BudgetVotingSection
                  currentCycle={currentCycle}
                  votingView={votingView}
                  isOwner={isOwner}
                  memberNameById={memberNameById}
                  branchNameById={branchNameById}
                  confirmedIds={confirmedIds}
                  myContributionSignal={myContributionSignal}
                />
              )}
            </section>
          )}

          {isAdmin && canStartNewCycle && (
            <section style={{ marginTop: "2rem", borderTop: "1px solid #ccc", paddingTop: "1rem" }}>
              <h2>Start a new budget cycle</h2>
              <form
                action={createBudgetCycleAction}
                style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 500 }}
              >
                <label>
                  Title
                  <br />
                  <input type="text" name="title" required style={{ padding: "0.4rem", width: "100%" }} />
                </label>
                <label>
                  Fixed costs — one per line, <code>label|amount</code> (optional)
                  <br />
                  <textarea
                    name="fixedCostsRaw"
                    rows={3}
                    placeholder={"Site fee|2000\nContingency|500"}
                    style={{ padding: "0.4rem", width: "100%", fontFamily: "monospace" }}
                  />
                </label>
                <label>
                  Proposal deadline
                  <br />
                  <input
                    type="datetime-local"
                    name="proposalDeadline"
                    required
                    style={{ padding: "0.4rem" }}
                  />
                </label>
                <label>
                  Owner task ID
                  <br />
                  <input
                    type="text"
                    name="ownerTaskId"
                    required
                    placeholder="paste the task's ID from its /tasks/… URL"
                    style={{ padding: "0.4rem", width: "100%" }}
                  />
                  <br />
                  <span style={{ fontSize: "0.8rem", color: "#666" }}>
                    Whoever holds this task is the budget owner.
                  </span>
                </label>
                <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
                  Start cycle
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </main>
  );
}
