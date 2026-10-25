import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { admission, recruitmentDecision } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { getCommunityRow } from "./access";
import { computeArrivalOutcome } from "./evaluations";
import { admitArrival, closeArrival, ensureArrivalForApplication, recordArrivalDecision } from "./admission";
import { openCheck } from "./community-check";

type Member = typeof memberTable.$inferSelect;
type RecruitmentDecisionRow = typeof recruitmentDecision.$inferSelect;

export async function getRecruitmentDecision(formResponseId: string) {
  const [row] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.formResponseId, formResponseId));
  return row ?? null;
}

// A decision is about an arrival (§4); the application is simply one thing it can have.
export async function getArrivalDecision(arrivalId: string) {
  const [row] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.arrivalId, arrivalId));
  return row ?? null;
}

async function arrivalOfDecision(decision: RecruitmentDecisionRow) {
  if (decision.arrivalId) {
    const [row] = await db.select().from(admission).where(eq(admission.id, decision.arrivalId));
    if (row) return row;
  }
  return decision.formResponseId ? ensureArrivalForApplication(decision.formResponseId) : null;
}

// An accepted application becomes a member through the one admission function
// (docs/plans/admission-flow.md §6), the same as every other way in, so what a new
// member starts with — an identity, a way to be reached, a place in the event,
// the answers they already gave on the form — cannot differ by route. The
// arrival is made here for an application that predates arrivals and is still
// in flight; a form that can't identify a person at all (no question marked as
// their name and email) is a real, visible limitation, surfaced on the
// submitRecruitmentApplication no longer lets such a form take applications.
async function maybeConvertApplicantToMember(decision: RecruitmentDecisionRow): Promise<RecruitmentDecisionRow> {
  if (decision.convertedMemberId) return decision;
  const arrival = await arrivalOfDecision(decision);
  if (!arrival) return decision;
  await admitArrival(arrival.id);
  const [updated] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision.id));
  return updated ?? decision;
}

// One decision, applied to one arrival: the funnel's own way of saying "this
// arrival is accepted" or "this arrival is declined", whatever caused it — the
// support shortcut reaching its number, a community check that ended (the clock,
// mediation clearing a concern, mediation upholding one). Nothing here asks who is
// calling, which is the point (docs/plans/admission-flow.md §5): the old mediation
// outcome went through a holder-only function and was lost when its caller wasn't
// one, and the window's clock then applied its *default* in its place.
//
// Skipping or deciding the evaluating does not skip the bookkeeping that follows an
// acceptance, so the record, the member and their accompaniment agree about what
// happened. If the evaluators have not decided yet there is no decision row to
// resolve, so one is made, saying `proceed` (the nearest honest word); a decision
// already waiting out a wider discussion is resolved. An arrival with no
// application has no decision at all — it is admitted or closed.
export async function settleArrivalDecision(arrival: typeof admission.$inferSelect, resolution: "accepted" | "declined") {
  // An arrival whose lane asks for no reports and sent no application (a community
  // check on its own) has nothing a decision would be about.
  if (!arrival.formResponseId && !arrival.requiredEvaluation) {
    if (resolution === "accepted") return admitArrival(arrival.id);
    await closeArrival(arrival.id, "declined");
    return null;
  }
  const [existing] = await db
    .select()
    .from(recruitmentDecision)
    .where(arrival.formResponseId ? or(eq(recruitmentDecision.arrivalId, arrival.id), eq(recruitmentDecision.formResponseId, arrival.formResponseId)) : eq(recruitmentDecision.arrivalId, arrival.id));
  if (!existing) {
    await db.insert(recruitmentDecision).values({
      arrivalId: arrival.id,
      formResponseId: arrival.formResponseId,
      ruleOutcome: resolution === "accepted" ? "proceed" : "decline",
      resolution,
    });
  } else if (existing.resolution !== resolution) {
    await db.update(recruitmentDecision).set({ resolution }).where(eq(recruitmentDecision.id, existing.id));
  }
  await recordArrivalDecision(arrival.id, resolution);
  if (resolution === "declined") return null;

  // Admitting is what makes the member, and the one place that is done also makes the
  // accompaniment (docs/plans/accompaniment-plan.md §3.2), so there is nothing to add here.
  return admitArrival(arrival.id);
}

/** The support shortcut reaching its number accepts an application the way a `proceed` does. */
export async function acceptArrivalByShortcut(arrival: typeof admission.$inferSelect) {
  return settleArrivalDecision(arrival, "accepted");
}

// The real, persisted trigger point Phase 33 deliberately didn't build — called after
// every report, but only actually does anything the first time enough of them are in for
// the arrival (idempotent: a recruitmentDecision row already existing means this is a
// no-op). See src/db/schema/recruitment.ts's recruitmentDecision comment for the full
// state-machine reasoning.
export async function recordArrivalDecisionIfReached(actor: Member, arrivalId: string) {
  const existing = await getArrivalDecision(arrivalId);
  if (existing) return existing;

  const [arrival] = await db.select().from(admission).where(eq(admission.id, arrivalId));
  if (!arrival) return null;
  const communityRow = await getCommunityRow(arrival.communityId);
  const result = await computeArrivalOutcome(communityRow, arrivalId);
  if (!result.outcome) return null;

  const resolution: "accepted" | "declined" | null =
    result.outcome === "proceed" ? "accepted" : result.outcome === "decline" ? "declined" : null;

  const [created] = await db
    .insert(recruitmentDecision)
    .values({
      arrivalId,
      formResponseId: arrival.formResponseId,
      ruleOutcome: result.outcome,
      defaultResolution: result.defaultResolution,
      resolution,
    })
    .returning();

  let decisionRow = created;
  await recordArrivalDecision(arrivalId, resolution);

  // A wider discussion is a community check (§5): a window on the arrival in which
  // any member can raise a concern, ending by what the decision form said it does
  // when nobody does. The window's length and deadline live on the check, which is
  // the one place they are read.
  if (result.outcome === "wider_discussion") {
    await openCheck(arrival, "evaluation", result.defaultResolution === "proceed" ? "admit" : "decline");
  }

  // There is no call to schedule here any more. The interview comes *before* the
  // decision (docs/plans/admission-flow.md §2): it was made when the arrival entered, and
  // the reports being decided from are the interviewers' own. A decision only
  // records what the reports lead to.

  if (resolution === "accepted") {
    // The member, and with them the accompaniment, are made by the admission itself.
    decisionRow = await maybeConvertApplicantToMember(decisionRow);
  }

  return decisionRow;
}

// The same, asked about an application (an application that predates arrivals is given
// its arrival first).
export async function recordDecisionIfReached(actor: Member, formResponseId: string) {
  const existing = await getRecruitmentDecision(formResponseId);
  if (existing) return existing;
  const arrival = await ensureArrivalForApplication(formResponseId);
  return arrival ? recordArrivalDecisionIfReached(actor, arrival.id) : null;
}
