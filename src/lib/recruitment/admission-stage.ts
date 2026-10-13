import type { AdmissionOrigin, AdmissionVerification } from "@/db/schema";

// docs/plans/admission-flow.md §4 — "The stage is a pure function of the facts
// and the path."
//
// This file is the whole of that. It imports no database, no drizzle, and
// nothing that does: given a path and a set of facts it returns the stage,
// and it cannot disagree with itself because there is nothing to keep in
// step. Every screen, the pipeline, the dashboard's needs-action list and
// capacity counting read this and nothing else.
//
// That constraint is the reason the type below takes plain values rather
// than a database row. The old computed stage (src/lib/recruitment/
// pipeline.ts) took a communityRow and went back to the database for the
// evaluations, the decision and the poll, which is why it could only ever
// cover the evaluated path and why its own comment records the two places
// spec's arrow chain and the built code disagree. This one is told what it
// needs and reads nothing.

// The path, as snapshotted onto the arrival at entry (§1 principle 2: a
// lane decides the path and the path is fixed when they arrive).
export type AdmissionPath = {
  verification: AdmissionVerification;
  applicationRequired: boolean;
  interviewRequired: boolean;
  evaluationRequired: boolean;
  reportsNeeded: number | null;
  supportShortcutCount: number | null;
};

// The facts, each written by exactly one function (§4). Optional rather
// than null because "not yet" and "explicitly not" are the same answer
// everywhere here — a missing timestamp means the thing has not happened.
export type AdmissionFacts = {
  consentGiven: boolean;
  /**
   * A community-check window that opened at entry is running (§5). Not "has the check
   * passed": a window can end by sending the person back for more, and the lane's path
   * then has steps after it, so what matters to the stage is only whether it is still
   * holding the arrival.
   */
  checkOpen: boolean;
  applicationSubmitted: boolean;
  interviewScheduled: boolean;
  interviewHeld: boolean;
  evaluationsFiled: number;
  decisionRecorded: boolean;
  /** The reports led to a wider discussion and its window is still open (§5): the community's, not the holders'. */
  widerDiscussionOpen?: boolean;
  supportShortcutReached: boolean;
  admitted: boolean;
  declined: boolean;
  withdrawn: boolean;
  waitlisted: boolean;
  origin: AdmissionOrigin;
};

// Ordered to match §2's arrow. The order is the whole point: the first
// matching row wins, so a terminal outcome beats every incomplete step
// above it without any row needing to know what comes after.
export const ADMISSION_STAGES = [
  "withdrawn",
  "admitted",
  "waitlisted",
  "declined",
  "application_submitted",
  "evaluation_in_progress",
  "interview_scheduled",
  "interview_held",
  "decision_pending",
  "wider_discussion",
  "check_pending",
  "awaiting_consent",
  "entered",
] as const;
export type AdmissionStage = (typeof ADMISSION_STAGES)[number];

export type AdmissionStageReason =
  | "withdrawn_by_person"
  | "admitted"
  | "admitted_waitlisted_for_room"
  | "declined"
  | "application_submitted"
  | "evaluations_outstanding"
  | "interview_scheduled"
  | "interview_not_held"
  | "held_awaiting_reports"
  | "wider_discussion_open"
  | "check_pending"
  | "awaiting_consent"
  | "entered";

// The stages a person cannot move on from by themselves. Kept beside the
// list rather than spelled out at each return, so adding a terminal stage
// is one edit and cannot be forgotten by one call site.
const TERMINAL_STAGES: ReadonlySet<AdmissionStage> = new Set<AdmissionStage>([
  "withdrawn",
  "admitted",
  "waitlisted",
  "declined",
]);

export type AdmissionStageReadout = {
  stage: AdmissionStage;
  reason: AdmissionStageReason;
  /** When this stage began — what "how long have they sat there" is measured from. */
  since: Date | null;
  /** Evaluations filed against `reportsNeeded`, for "2 of 3 reports" copy. */
  evaluationsFiled: number;
  reportsNeeded: number | null;
  /**
   * Whether the next thing due is the person's own move — an application
   * not sent, availability not offered, a consent not ticked. Set by the
   * caller rather than derived here, because "is this person overdue"
   * depends on a period (when did we email them) that lives outside the
   * funnel, and it is the caller's business, not the stage function's.
   */
  arrivalIsWaitingOnThePerson: boolean;
};

export type AdmissionStageFacts = AdmissionFacts & {
  enteredAt: Date;
  applicationSubmittedAt?: Date | null;
  interviewScheduledAt?: Date | null;
  interviewHeldAt?: Date | null;
  checkPassedAt?: Date | null;
  supportShortcutReachedAt?: Date | null;
  admittedAt?: Date | null;
  waitlistedAt?: Date | null;
  declinedAt?: Date | null;
  withdrawnAt?: Date | null;
};

const reportsNeededFor = (path: AdmissionPath) =>
  path.evaluationRequired ? (path.reportsNeeded ?? 0) : 0;

// The support shortcut short-circuits whatever is left (§2): when it has
// been reached the arrival is on its way to being admitted, so no remaining
// step can hold it. It never overrides a standing concern — that is checked
// where the shortcut is recorded, not here, because "is a concern standing"
// is a fact about the check and not about the path.
const shortcutReached = (facts: AdmissionFacts) =>
  facts.supportShortcutReached && !facts.declined && !facts.withdrawn;

/**
 * Where this person is, derived from what has happened and the path they
 * entered on.
 *
 * Pure: no I/O, no clock of its own (every date comes in), so the whole
 * table below is testable by calling this twice.
 */
export function computeAdmissionStage(
  path: AdmissionPath,
  facts: AdmissionStageFacts,
  /** See `arrivalIsWaitingOnThePerson` — the caller owns this. Defaults false. */
  options: { waitingOnThePerson?: boolean } = {},
): AdmissionStageReadout {
  const needed = reportsNeededFor(path);
  const progress = {
    evaluationsFiled: facts.evaluationsFiled,
    reportsNeeded: path.reportsNeeded,
    arrivalIsWaitingOnThePerson: options.waitingOnThePerson ?? false,
  };

  const done = (
    stage: AdmissionStage,
    reason: AdmissionStageReason,
    since: Date | null,
  ): AdmissionStageReadout => ({ stage, reason, since, ...progress });

  // Terminal, in the order §2's table implies. Declined is checked before
  // the shortcut because a decline is a person's answer and outranks a
  // count; a support shortcut that landed after a decline changed nothing,
  // which is why it is recorded as not reached in the first place.
  if (facts.withdrawn) return done("withdrawn", "withdrawn_by_person", facts.withdrawnAt ?? facts.enteredAt);
  if (facts.admitted) return done("admitted", "admitted", facts.admittedAt ?? facts.enteredAt);
  if (facts.waitlisted)
    return done("waitlisted", "admitted_waitlisted_for_room", facts.waitlistedAt ?? facts.enteredAt);
  if (facts.declined) return done("declined", "declined", facts.declinedAt ?? facts.enteredAt);

  // A reached shortcut means the rest of the path is being skipped, so the
  // person is admitted rather than sitting at whatever step they had not
  // yet reached. Surfaced as `entered` here and `admitted` the moment the
  // admission function has run, so the window between "skipped" and
  // "admitted" is visible rather than skipped over.
  if (shortcutReached(facts) && !facts.admitted) return done("entered", "admitted", facts.supportShortcutReachedAt ?? facts.enteredAt);

  // A lane with neither an application nor an interview has no evaluation
  // either, so there is nothing to wait on and the person is admitted as
  // soon as consent and the check are out of the way. §3's "both off means
  // admitted immediately, stated plainly".
  const nothingToEvaluate = !path.applicationRequired && !path.interviewRequired && !path.evaluationRequired;

  if (path.verification === "community_check") {
    // Consent comes before the announcement: the arrival is only visible to
    // the community once the person has agreed to it being visible (§5).
    if (!facts.consentGiven) return done("awaiting_consent", "awaiting_consent", facts.enteredAt);
    if (facts.checkOpen) return done("check_pending", "check_pending", facts.enteredAt);
    // §3: on a community-check lane the check *is* the process, so the
    // person is done once it has ended — unless mediation asked for more, which
    // added steps to the path and so is not "nothing to evaluate".
    if (nothingToEvaluate) return done("entered", "admitted", facts.checkPassedAt ?? facts.enteredAt);
  }
  // A lane without a community check asks for no consent: the person's own
  // act of arriving (sending an application, using an invite) is their
  // agreement to be in the process, and nothing about them is announced.

  // §2's arrow, walked in order. The stages below are "the last thing that
  // happened", which is why an application with nothing else on it is
  // `application_submitted` and not `evaluation_in_progress` — the
  // distinction the existing pipeline draws too ("applied (submitted,
  // nothing else yet) → evaluation in progress (some but not all filed)").

  const appliedAt = facts.applicationSubmittedAt ?? facts.enteredAt;

  // Application. Required and not sent: the person's own next move.
  if (path.applicationRequired && !facts.applicationSubmitted)
    return done("entered", "entered", facts.enteredAt);

  // Interview. Not yet arranged, then arranged but not held. Nothing about
  // evaluation is consulted here — a lane with an interview is waiting for
  // the interview, and the reports about it cannot exist before the people
  // in it have had the call.
  if (path.interviewRequired) {
    if (!facts.interviewScheduled)
      return done(
        path.applicationRequired ? "application_submitted" : "entered",
        "entered",
        appliedAt,
      );
    if (!facts.interviewHeld)
      return done("interview_scheduled", "interview_scheduled", facts.interviewScheduledAt ?? appliedAt);
  }

  // Nothing to evaluate on this lane: every step it asked for has happened.
  if (nothingToEvaluate)
    return done("entered", "admitted", facts.interviewHeldAt ?? appliedAt);

  // Evaluation. The reports are what the arrival is waiting on, whether the
  // lane has an interview (the interviewers' reports, filed after the call)
  // or not (any holder's, §2).
  const since = facts.interviewHeldAt ?? appliedAt;
  if (facts.evaluationsFiled < needed) {
    // The call has happened and the reports are with the people who took
    // part in it — so the wait is theirs, and saying so is the useful part.
    if (facts.interviewHeld) return done("interview_held", "held_awaiting_reports", since);
    // Before that, "your application is in" while nothing has been written
    // about it; the first report is what moves it to being under way.
    const stage =
      facts.evaluationsFiled === 0
        ? path.applicationRequired
          ? "application_submitted"
          : "entered"
        : "evaluation_in_progress";
    return done(stage, "evaluations_outstanding", since);
  }

  // Reports in and the policy sent them to a wider discussion: the window belongs to
  // the community, and a standing concern to the mediation body — nobody here is stuck.
  if (!facts.decisionRecorded && facts.widerDiscussionOpen) return done("wider_discussion", "wider_discussion_open", since);

  // Reports in, decision not made: the community's policy owns this one.
  if (!facts.decisionRecorded) return done("decision_pending", "held_awaiting_reports", since);

  // Everything this lane asked for has happened and nothing has objected.
  // Admission is the next thing to happen, not a state the person is in.
  return done("entered", "admitted", since);
}

/**
 * Is this arrival waiting on somebody? The needs-action list is this, so a
 * person who is waiting on *themselves* is not an action item for the
 * community.
 *
 * Deliberately separate from the stage rather than a field beside it: "in
 * flight" and "somebody must act" are different questions, and the old
 * pipeline conflated them into NEEDS_ACTION_STAGES.
 */
export function admissionNeedsAction(stage: AdmissionStageReadout): boolean {
  // Finished, or on its way in: nobody in the community has anything to do.
  if (TERMINAL_STAGES.has(stage.stage)) return false;
  if (stage.reason === "admitted") return false;
  // Consent and a community check are the community's own steps, and both
  // are visible on their own screens already (§3 shows the window setting
  // and the mediation queue), so listing them here would be a second place
  // the same thing is chased from.
  if (stage.stage === "awaiting_consent" || stage.stage === "check_pending" || stage.stage === "wider_discussion") return false;
  // A booked interview is waiting for the call to happen, which nobody can hurry.
  if (stage.stage === "interview_scheduled") return false;
  // Everything else in flight is an outstanding report, an unscheduled or
  // unheld interview, or a decision unmade — all work the holders own. If
  // the arrival is also waiting on the person's own step, the flag the
  // caller sets says so and it is not an action item, because chasing it is
  // chasing them for something they have to do first.
  return !stage.arrivalIsWaitingOnThePerson;
}

/**
 * The plain sentence a person sees on their own page (§4: "where they are,
 * in plain words, and what happens next").
 *
 * Generated rather than assembled by callers so the person's page, the
 * holders' views and any email cannot describe three different stages.
 */
export function describeAdmissionStage(stage: AdmissionStageReadout): string {
  const { reportsNeeded, evaluationsFiled } = stage;
  switch (stage.stage) {
    case "withdrawn":
      return "You have withdrawn from this application. Get in touch if that changes.";
    case "admitted":
      return "You're in. Your account is ready and we've sent you a link to it.";
    case "waitlisted":
      return "You're in as soon as there's room — we'll be in touch.";
    case "declined":
      return "This time it's not been a yes. If you'd like to talk about it, the community will get back to you.";
    case "check_pending":
      return "Your arrival has been announced. If anyone has a concern they'll raise it privately, and you'll hear how it went.";
    case "awaiting_consent":
      return "There's one thing we need from you before we can go any further.";
    case "interview_scheduled":
      return "Your interview is booked. Nothing else to do until then.";
    case "interview_held":
      return "Your interview has happened. The people you met are writing up what they think.";
    case "decision_pending":
      return "Everything's been said. The community's rules are deciding now.";
    case "wider_discussion":
      return "The people who met you have reported, and the community has a short window to raise any concern before it's decided.";
    case "evaluation_in_progress":
      return evaluationsFiled === 0 && reportsNeeded
        ? `We're looking for ${reportsNeeded} ${reportsNeeded === 1 ? "recommendation" : "recommendations"} about you.`
        : `${evaluationsFiled} of ${reportsNeeded ?? 0} recommendations in.`;
    case "application_submitted":
      return "Your application is in.";
    case "entered":
      return stage.reason === "admitted"
        ? "You're in — hold on while we finish setting you up."
        : "You're in the funnel. We'll be in touch about what comes next.";
  }
}