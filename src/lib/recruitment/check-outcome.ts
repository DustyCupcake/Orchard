import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { admission, communityCheck, communityCheckConcern, recruitmentDecision } from "@/db/schema";
import type { CommunityCheckEndedAs } from "@/db/schema";
import { AppError, ConflictError } from "../errors";
import { sendAskedForMoreEmail } from "../mailer";
import { admitArrival, admissionLink, communityNameOf, ensureArrivalForApplication } from "./admission";
import { arrivalIsFinished, listChecksFor, listOpenChecks, openCheck } from "./community-check";
import { settleArrivalDecision } from "./decisions";
import { DEFAULT_REPORTS_NEEDED } from "./lane-rules";

// docs/plans/admission-flow.md §5 — what happens when a community check *ends*.
//
// One function decides it, and it decides it from what is on the record, never
// from who happened to call it. That is the fix for the old design's lost
// outcome: mediation marked a concern settled and then called a holder-only
// function, which refused, and the window's clock later applied its *default* —
// admitting someone whose concern had been upheld. Here the clock, a mediation
// member's settlement and the person withdrawing all do the same thing: record
// their part, then ask this to look at the window. If anything after the record
// fails, the next look finishes the job, because the answer is still on the page.
//
//   a concern upheld           → the person is declined (and it answers every other
//                                concern standing, which are marked moot)
//   a concern asked for more   → the path gains the steps asked for; the person is
//                                taken back to them, evaluated and decided like
//                                anyone else
//   a concern still standing   → nothing: it holds the arrival until mediation acts
//   every concern settled      → the window passes
//   no concern, deadline past  → the window passes by what it said it would do
//
// "Passes" means: an entry check lets the arrival go on to whatever its path has
// left (a lane that is nothing else admits them); an evaluation check resolves the
// decision, admitting when mediation cleared it and by the decision form's own
// "ends with no concern" answer when nobody spoke.

export type ReconcileResult = "waiting" | "ended" | "held";

/** What "ask for more" asks for. */
export type AskForMore = { application: boolean; interview: boolean };

type Arrival = typeof admission.$inferSelect;
type Check = typeof communityCheck.$inferSelect;

async function endCheckRow(
  checkId: string,
  endedAs: CommunityCheckEndedAs,
  by?: { memberId: string | null; note: string | null },
): Promise<boolean> {
  // `closed` is what the arrival's own ending writes (admission and decline
  // close any open window); the reason it ended is more than that, so it may be
  // overwritten once, by the outcome that caused the ending.
  const [updated] = await db
    .update(communityCheck)
    .set({
      endedAt: sql`coalesce(${communityCheck.endedAt}, now())`,
      endedAs,
      endedById: by?.memberId ?? null,
      endedNote: by?.note ?? null,
    })
    .where(
      and(eq(communityCheck.id, checkId), sql`(${communityCheck.endedAt} is null or ${communityCheck.endedAs} = 'closed')`),
    )
    .returning({ id: communityCheck.id });
  return Boolean(updated);
}

async function markStandingMoot(checkId: string) {
  await db
    .update(communityCheckConcern)
    .set({ resolution: "moot", resolvedAt: new Date() })
    .where(and(eq(communityCheckConcern.checkId, checkId), eq(communityCheckConcern.resolution, "standing")));
}

/**
 * Can the body ask this arrival for more, and for this? Called when it is asked
 * (so a mediation member gets the sentence then, not after settling), and again
 * when the outcome is applied.
 *
 * It is offered on a window that opened at entry, because that is when there is
 * something left to ask for: an arrival whose window opened after its reports has
 * already given an application and been interviewed as its lane asked, and a
 * second round of the same would be a decision made twice.
 */
export function assertCanAskForMore(arrival: Arrival, check: Pick<Check, "kind">, ask: AskForMore): void {
  if (!ask.application && !ask.interview) {
    throw new AppError("Say what you'd like to ask for — an application, a conversation, or both");
  }
  if (check.kind !== "entry") {
    throw new ConflictError(
      "This arrival has already given what their lane asked for and been read about, so there's nothing more to ask for. The choices now are to clear the concern, uphold it, or overrule it.",
    );
  }
  if (ask.application && arrival.requiredApplication) {
    throw new ConflictError("They've already been asked for an application");
  }
  if (ask.interview && arrival.requiredInterview) {
    throw new ConflictError("They've already been asked for a conversation");
  }
}

async function applyAskForMore(arrival: Arrival, check: Check) {
  assertCanAskForMore(arrival, check, { application: check.askedApplication, interview: check.askedInterview });
  await db
    .update(admission)
    .set({
      requiredApplication: arrival.requiredApplication || check.askedApplication,
      requiredInterview: arrival.requiredInterview || check.askedInterview,
      requiredEvaluation: true,
      reportsNeeded: arrival.reportsNeeded ?? DEFAULT_REPORTS_NEEDED,
    })
    .where(eq(admission.id, arrival.id));
}

/** The entry window passed: record it, and admit if that was all the path had. */
async function passEntryCheck(arrival: Arrival) {
  await db
    .update(admission)
    .set({ checkPassedAt: new Date() })
    .where(and(eq(admission.id, arrival.id), isNull(admission.checkPassedAt)));
  const [fresh] = await db.select().from(admission).where(eq(admission.id, arrival.id));
  if (!fresh || arrivalIsFinished(fresh)) return;
  // The check *is* the process on a lane that asks for nothing else (§3), so passing
  // it admits. A path with steps left — an application, a conversation, reports —
  // carries on through them, and the decision admits at the end. (Asked directly
  // rather than through the stage readout, because this window is still the one
  // holding the arrival until the caller has recorded how it ended.)
  const nothingElse = !fresh.requiredApplication && !fresh.requiredInterview && !fresh.requiredEvaluation;
  if (nothingElse) await admitArrival(fresh.id);
}

/**
 * Look at one open window and do what the record says is due.
 *
 * Idempotent and safe to call from anywhere — after a concern is settled or
 * withdrawn, from the clock — because it reads the concerns and the clock afresh
 * and changes only what they decide. `waiting` is a window with nothing to do yet,
 * `held` one with a concern standing that only mediation can settle, `ended` one
 * that has just been ended.
 */
export async function reconcileCheck(checkId: string): Promise<ReconcileResult> {
  const [check] = await db.select().from(communityCheck).where(eq(communityCheck.id, checkId));
  if (!check || check.endedAt) return "waiting";
  const [arrival] = await db.select().from(admission).where(eq(admission.id, check.arrivalId));
  if (!arrival) return "waiting";

  // The arrival ended some other way (withdrew, admitted by another route): the
  // window has nothing left to gate.
  if (arrivalIsFinished(arrival)) {
    await endCheckRow(check.id, "closed");
    return "ended";
  }

  const concerns = await db
    .select()
    .from(communityCheckConcern)
    .where(eq(communityCheckConcern.checkId, check.id))
    .orderBy(communityCheckConcern.resolvedAt);
  const decidedBy = (c?: { resolvedById: string | null; resolutionNote: string | null }) => ({
    memberId: c?.resolvedById ?? null,
    note: c?.resolutionNote ?? null,
  });

  const upheld = concerns.find((c) => c.resolution === "upheld");
  if (upheld) {
    await settleArrivalDecision(arrival, "declined");
    await markStandingMoot(check.id);
    await endCheckRow(check.id, "upheld", decidedBy(upheld));
    return "ended";
  }

  const asked = concerns.find((c) => c.resolution === "asked_for_more");
  if (asked) {
    await applyAskForMore(arrival, check);
    await markStandingMoot(check.id);
    const won = await endCheckRow(check.id, "asked_for_more", decidedBy(asked));
    // Only the call that ended it tells the person, so asking once is one email.
    if (won) {
      await notifyAskedForMore(arrival, check);
      // A conversation asked for on its own can be arranged now the window no longer holds
      // them; one asked for with an application waits for the application (submitAskedApplication).
      if (check.askedInterview && !check.askedApplication) {
        try {
          const { ensureInterviewPoll } = await import("./interviews");
          await ensureInterviewPoll(arrival.id);
        } catch (err) {
          console.error("[community check] could not make the interview poll", err);
        }
      }
    }
    return "ended";
  }

  if (concerns.some((c) => c.resolution === "standing")) return "held";

  const settled = concerns.filter((c) => c.resolution !== "moot");
  if (settled.length > 0) {
    const overruled = settled.some((c) => c.resolution === "overruled");
    const latest = settled[settled.length - 1];
    // Mediation (or whoever raised it) let it go: the arrival carries on. For an
    // evaluation window that is an admission — the concern was the only thing
    // standing between the reports and a yes.
    if (check.kind === "entry") await passEntryCheck(arrival);
    else await settleArrivalDecision(arrival, "accepted");
    await endCheckRow(check.id, overruled ? "overruled" : "cleared", decidedBy(latest));
    return "ended";
  }

  if (check.deadline > new Date()) return "waiting";

  // Nobody said anything in time: the window does what it said it would.
  if (check.onQuiet === "continue") await passEntryCheck(arrival);
  else await settleArrivalDecision(arrival, check.onQuiet === "admit" ? "accepted" : "declined");
  await endCheckRow(check.id, "quiet");
  return "ended";
}

/**
 * The scheduled half: look at every open window. It can end a window only by what
 * the record already says — never by deciding a concern — so a standing one is
 * reported as held and left where mediation owes it an answer, which is the fix for
 * the veto-by-inaction the redesign names (a passive team used to leave a concern
 * hanging with nobody told). It also finishes any outcome whose last step failed.
 */
export async function closeDueChecks() {
  await adoptLegacyDiscussions();
  const open = await listOpenChecks();
  let ended = 0;
  let held = 0;
  for (const check of open) {
    const result = await reconcileCheck(check.id);
    if (result === "ended") ended++;
    else if (result === "held") held++;
  }
  return { checked: open.length, ended, held };
}

/**
 * A wider discussion that was opened before windows were rows: the decision says it is
 * still waiting, and nothing else knows. Give it its window — on its arrival, made now
 * if the application predates arrivals — with the deadline and the answer it already
 * had, so nobody is left in a discussion that no longer has anything to end it.
 * (Decisions made since then open their window themselves.) Cheap: the unresolved
 * discussions are few, and each is looked at once.
 */
async function adoptLegacyDiscussions() {
  const waiting = await db
    .select()
    .from(recruitmentDecision)
    .where(and(eq(recruitmentDecision.ruleOutcome, "wider_discussion"), isNull(recruitmentDecision.resolution)));
  for (const decision of waiting) {
    const arrival = decision.arrivalId
      ? (await db.select().from(admission).where(eq(admission.id, decision.arrivalId)))[0]
      : decision.formResponseId
        ? await ensureArrivalForApplication(decision.formResponseId)
        : null;
    if (!arrival || arrivalIsFinished(arrival)) continue;
    if ((await listChecksFor(arrival.id)).some((c) => c.kind === "evaluation")) continue;
    await openCheck(arrival, "evaluation", decision.defaultResolution === "proceed" ? "admit" : "decline", {
      deadline: decision.widerDiscussionDeadline ?? undefined,
    });
  }
}

async function notifyAskedForMore(arrival: Arrival, check: Check) {
  try {
    await sendAskedForMoreEmail(arrival.email, {
      name: arrival.name,
      communityName: await communityNameOf(arrival.communityId),
      statusUrl: admissionLink(arrival.token),
      application: check.askedApplication,
      interview: check.askedInterview,
    });
  } catch (err) {
    console.error("[community check] could not send the asked-for-more email", err);
  }
}
