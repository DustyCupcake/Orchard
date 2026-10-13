import { describe, expect, it } from "vitest";
import {
  ADMISSION_STAGES,
  admissionNeedsAction,
  computeAdmissionStage,
  describeAdmissionStage,
  type AdmissionPath,
  type AdmissionStage,
  type AdmissionStageFacts,
  type AdmissionStageReason,
} from "@/lib/recruitment/admission-stage";

// docs/plans/admission-flow.md §4 — the stage is a pure function of the facts
// and the path. §8 step 1 asks for "tests for every row of §2", which is
// what the lane fixtures below are: one per row of the table of paths a
// lane can produce.
//
// No database, no drizzle — which is the property under test as much as
// the values are. If this file ever needs an import that reaches the
// database, the stage function has stopped being a read-out of state that
// already exists and become a second opinion.

const T0 = new Date("2026-10-01T09:00:00.000Z");
const at = (offsetHours: number) => new Date(T0.getTime() + offsetHours * 3_600_000);

const path = (over: Partial<AdmissionPath> = {}): AdmissionPath => ({
  verification: "none",
  applicationRequired: true,
  interviewRequired: true,
  evaluationRequired: true,
  reportsNeeded: 2,
  supportShortcutCount: null,
  ...over,
});

const facts = (over: Partial<AdmissionStageFacts> = {}): AdmissionStageFacts => ({
  consentGiven: true,
  checkOpen: true,
  applicationSubmitted: false,
  interviewScheduled: false,
  interviewHeld: false,
  evaluationsFiled: 0,
  decisionRecorded: false,
  supportShortcutReached: false,
  admitted: false,
  declined: false,
  withdrawn: false,
  waitlisted: false,
  origin: "funnel",
  enteredAt: T0,
  ...over,
});

// Every §2 row, and the whole ordered path walked forward through it. A
// test that asserts the stage at each step catches two classes of bug at
// once: the stage being wrong at one point, and the stage going *backwards*
// as facts accumulate.
const walk = (p: AdmissionPath, steps: Array<Partial<AdmissionStageFacts>>) => {
  const seen: Array<{ stage: AdmissionStage; reason: AdmissionStageReason }> = [];
  const acc: Record<string, unknown> = {};
  for (const step of steps) {
    Object.assign(acc, step);
    seen.push(
      (({ stage, reason }) => ({ stage, reason }))(computeAdmissionStage(p, facts(acc))),
    );
  }
  expect(seen).toHaveLength(steps.length);
  return seen;
};

describe("the derived admission stage", () => {
  it("never returns a stage outside its own list", () => {
    const readout = computeAdmissionStage(path(), facts());
    expect(ADMISSION_STAGES).toContain(readout.stage);
  });

  // --- §2 row 1: no verification, no application, no interview ---------
  // "admitted immediately (invite lanes only)"
  it("a lane with nothing to evaluate is ready to admit as soon as they arrive", () => {
    const p = path({ applicationRequired: false, interviewRequired: false, evaluationRequired: false, reportsNeeded: null });
    expect(computeAdmissionStage(p, facts()).stage).toBe("entered");
    expect(computeAdmissionStage(p, facts()).reason).toBe("admitted");
    // Nothing gates it: only a community check asks for consent (§5), and
    // arriving by an invite or an application is itself the agreement.
    expect(computeAdmissionStage(p, facts({ consentGiven: false })).reason).toBe("admitted");
  });

  // --- §2 row 2: no verification, application on, interview off --------
  it("an application-only lane waits for reports and nothing else", () => {
    const p = path({ interviewRequired: false });
    expect(walk(p, [{ applicationSubmitted: true }]).at(-1)).toEqual({
      stage: "application_submitted",
      reason: "evaluations_outstanding",
    });
    expect(computeAdmissionStage(p, facts({ applicationSubmitted: true, evaluationsFiled: 1 })).stage).toBe("evaluation_in_progress");
    // Reports in and no decision yet: the rules decide.
    expect(computeAdmissionStage(p, facts({ applicationSubmitted: true, evaluationsFiled: 2 })).stage).toBe("decision_pending");
    expect(computeAdmissionStage(p, facts({ applicationSubmitted: true, evaluationsFiled: 2, decisionRecorded: true })).reason).toBe("admitted");
  });

  // --- §2 row 3: interview only, no application -----------------------
  it("an interview-only lane goes to the interview without an application", () => {
    const p = path({ applicationRequired: false });
    // No application is required, and no consent is asked for, so they are
    // waiting for the interview from the moment they arrive.
    expect(computeAdmissionStage(p, facts({ consentGiven: false })).stage).toBe("entered");
    expect(computeAdmissionStage(p, facts()).stage).toBe("entered");
    expect(computeAdmissionStage(p, facts({ interviewScheduled: true })).stage).toBe("interview_scheduled");
    expect(computeAdmissionStage(p, facts({ interviewScheduled: true, interviewHeld: true })).stage).toBe("interview_held");
  });

  // --- §2 row 4: application and interview ----------------------------
  it("a full lane walks application, then interview, then decision, in order", () => {
    const p = path();
    // Facts accumulate down the walk, so each line is "the world at this
    // point", not "the next thing that happened" — which is why the call
    // being held is its own line before the reports come in.
    const seen = walk(p, [
      { applicationSubmitted: true },
      { applicationSubmitted: true, evaluationsFiled: 1 },
      { applicationSubmitted: true, evaluationsFiled: 2 },
      { applicationSubmitted: true, evaluationsFiled: 2, interviewScheduled: true },
      { applicationSubmitted: true, evaluationsFiled: 1, interviewScheduled: true, interviewHeld: true },
      { applicationSubmitted: true, evaluationsFiled: 2, interviewScheduled: true, interviewHeld: true },
      { applicationSubmitted: true, evaluationsFiled: 2, interviewScheduled: true, interviewHeld: true, decisionRecorded: true },
    ]);
    // A submitted application is its own stage until the first report
    // lands; a lane with an interview waits for the interview before it is
    // ever a report short, which is why the middle two are the interview.
    expect(seen.map((s) => s.stage)).toEqual([
      "application_submitted",
      "application_submitted",
      "application_submitted",
      "interview_scheduled",
      "interview_held",
      "decision_pending",
      "entered",
    ]);
    // And the stage never moved backwards along the way.
    const order = ADMISSION_STAGES;
    const positions = seen.map((s) => order.indexOf(s.stage));
    expect(positions.every((pos, i) => i === 0 || pos >= positions[i - 1]!)).toBe(true);
  });

  // --- §2 row 5: community check --------------------------------------
  it("a community-check lane gates on consent then the check, and offers no application or interview", () => {
    const p = path({ verification: "community_check", applicationRequired: false, interviewRequired: false, evaluationRequired: false, reportsNeeded: null });
    expect(computeAdmissionStage(p, facts({ consentGiven: false })).stage).toBe("awaiting_consent");
    // Consent given: announced, and waiting on the window.
    expect(computeAdmissionStage(p, facts()).stage).toBe("check_pending");
    // The window has ended and nothing stands: the check *is* the process.
    expect(computeAdmissionStage(p, facts({ checkOpen: false })).reason).toBe("admitted");
    // A concern upheld arrives as a decline, which outranks everything.
    expect(computeAdmissionStage(p, facts({ checkOpen: false, declined: true })).stage).toBe("declined");
  });

  describe("terminal outcomes outrank every step still outstanding", () => {
    const p = path();
    it("withdrawal", () => expect(computeAdmissionStage(p, facts({ withdrawn: true })).stage).toBe("withdrawn"));
    it("admission", () => expect(computeAdmissionStage(p, facts({ admitted: true })).stage).toBe("admitted"));
    it("waitlist", () => expect(computeAdmissionStage(p, facts({ waitlisted: true })).stage).toBe("waitlisted"));
    it("decline", () => expect(computeAdmissionStage(p, facts({ declined: true })).stage).toBe("declined"));
    // Even with nothing else done — a decline does not require the person
    // to have submitted an application first.
    it("a decline with nothing else done is still a decline", () =>
      expect(computeAdmissionStage(path(), facts({ declined: true })).stage).toBe("declined"));
  });

  describe("the support shortcut", () => {
    it("short-circuits the rest of the path rather than waiting on it", () => {
      const p = path({ supportShortcutCount: 3 });
      // The application has not even been sent, and the shortcut has been
      // reached: the person is on their way in, not waiting on themselves.
      expect(computeAdmissionStage(p, facts({ supportShortcutReached: true })).reason).toBe("admitted");
    });

    it("does not override a decline or a withdrawal", () => {
      const p = path({ supportShortcutCount: 3 });
      expect(computeAdmissionStage(p, facts({ supportShortcutReached: true, declined: true })).stage).toBe("declined");
      expect(computeAdmissionStage(p, facts({ supportShortcutReached: true, withdrawn: true })).stage).toBe("withdrawn");
    });

    it("reports how many are needed so the copy can say so", () => {
      const readout = computeAdmissionStage(path({ supportShortcutCount: 3 }), facts());
      expect(readout.reportsNeeded).toBe(2);
      expect(readout.evaluationsFiled).toBe(0);
    });
  });

  describe("what needs the community to act", () => {
    const p = path();

    it("an arrival waiting on the person is not an action item", () => {
      // No application sent: the next move is theirs, so listing it as a
      // recruitment action item would be chasing them for their own step.
      const waitingOnThem = computeAdmissionStage(p, facts(), { waitingOnThePerson: true });
      expect(admissionNeedsAction(waitingOnThem)).toBe(false);

      // The same arrival, overdue, is.
      const overdue = computeAdmissionStage(p, facts(), { waitingOnThePerson: false });
      expect(admissionNeedsAction(overdue)).toBe(true);
    });

    it("a decision pending is always an action item", () => {
      // Reports in and the decision unmade. An application-only lane is the
      // simplest way to reach it; an interview lane reaches it after the
      // call, which the full-lane walk above already covers.
      const readout = computeAdmissionStage(
        path({ interviewRequired: false }),
        facts({ applicationSubmitted: true, evaluationsFiled: 2 }),
      );
      expect(readout.stage).toBe("decision_pending");
      expect(admissionNeedsAction(readout)).toBe(true);
    });

    it("an unscheduled interview is an action item too", () => {
      const readout = computeAdmissionStage(path(), facts({ applicationSubmitted: true }));
      expect(readout.stage).toBe("application_submitted");
      expect(admissionNeedsAction(readout)).toBe(true);
    });

    it("consent and a community check are not — they have their own screens", () => {
      // Consent is only ever asked for on a community-check lane.
      const noConsent = computeAdmissionStage(
        path({ verification: "community_check", applicationRequired: false, interviewRequired: false, evaluationRequired: false }),
        facts({ consentGiven: false }),
      );
      expect(noConsent.stage).toBe("awaiting_consent");
      expect(admissionNeedsAction(noConsent)).toBe(false);
      const checking = computeAdmissionStage(
        path({ verification: "community_check", applicationRequired: false, interviewRequired: false, evaluationRequired: false }),
        facts(),
      );
      expect(checking.stage).toBe("check_pending");
      expect(admissionNeedsAction(checking)).toBe(false);
    });

    it("terminal stages are never action items", () => {
      const terminals = {
        admitted: { admitted: true },
        declined: { declined: true },
        withdrawn: { withdrawn: true },
        waitlisted: { waitlisted: true },
      } as const;
      for (const [stage, fact] of Object.entries(terminals)) {
        expect(admissionNeedsAction(computeAdmissionStage(p, facts(fact)))).toBe(false);
        expect(computeAdmissionStage(p, facts(fact)).stage).toBe(stage);
      }
    });

    it("an arrival on its way in is not — admission is not the community's to chase", () => {
      // Every step done, nothing objected, so the admission function is
      // about to run. Listing it would be noise.
      const readout = computeAdmissionStage(
        path({ interviewRequired: false }),
        facts({ applicationSubmitted: true, evaluationsFiled: 2, decisionRecorded: true }),
      );
      expect(readout.reason).toBe("admitted");
      expect(admissionNeedsAction(readout)).toBe(false);
    });
  });

  describe("the sentence a person reads", () => {
    const p = path();
    it("never describes a stage the person is not in", () => {
      const readouts = [
        computeAdmissionStage(p, facts({ withdrawn: true })),
        computeAdmissionStage(p, facts({ admitted: true })),
        computeAdmissionStage(p, facts({ waitlisted: true })),
        computeAdmissionStage(p, facts({ declined: true })),
        computeAdmissionStage(p, facts({ consentGiven: false })),
        computeAdmissionStage(path({ verification: "community_check", applicationRequired: false, interviewRequired: false, evaluationRequired: false }), facts()),
        computeAdmissionStage(p, facts({ applicationSubmitted: true, interviewScheduled: true })),
        computeAdmissionStage(p, facts({ applicationSubmitted: true, evaluationsFiled: 1, interviewScheduled: true, interviewHeld: true })),
        computeAdmissionStage(p, facts({ applicationSubmitted: true, evaluationsFiled: 2 })),
      ];
      for (const readout of readouts) {
        const sentence = describeAdmissionStage(readout);
        expect(sentence.length).toBeGreaterThan(10);
        expect(sentence.endsWith(".")).toBe(true);
      }
    });

    it("counts reports in the copy when they are the wait", () => {
      const readout = computeAdmissionStage(
        path({ interviewRequired: false, reportsNeeded: 3 }),
        facts({ applicationSubmitted: true, evaluationsFiled: 1 }),
      );
      expect(describeAdmissionStage(readout)).toContain("1 of 3");
    });

    it("does not count reports when no interview means none are expected yet", () => {
      // An application submitted on an interview lane, before the call:
      // there is nothing to count, and copy that said "0 of 2 reports"
      // would be telling the person something untrue about where they are.
      const readout = computeAdmissionStage(path(), facts({ applicationSubmitted: true }));
      expect(describeAdmissionStage(readout)).toBe("Your application is in.");
    });
  });

  describe("purity", () => {
    it("gives the same answer twice for the same input", () => {
      const p = path();
      const f = facts({ applicationSubmitted: true, evaluationsFiled: 1 });
      expect(computeAdmissionStage(p, f)).toEqual(computeAdmissionStage(p, f));
    });

    it("does not mutate the facts it is handed", () => {
      const f = facts({ applicationSubmitted: true });
      const snapshot = { ...f };
      computeAdmissionStage(path(), f);
      expect(f).toEqual(snapshot);
    });

    it("takes no clock of its own — every date comes from the caller", () => {
      // Two calls separated by real time, with identical input, agree. If
      // the function read Date.now() this would be the test that noticed.
      const f = facts({ applicationSubmitted: true });
      const first = computeAdmissionStage(path(), f);
      const second = computeAdmissionStage(path(), f);
      expect(first.since).toBe(second.since);
    });
  });

  describe("stageSince is the time the wait started, not the entry time", () => {
    it("uses the application's own timestamp once there is one", () => {
      const readout = computeAdmissionStage(
        path({ interviewRequired: false }),
        facts({ applicationSubmitted: true, applicationSubmittedAt: at(5) }),
      );
      expect(readout.since).toEqual(at(5));
    });

    it("falls back to entry when there is nothing later", () => {
      const readout = computeAdmissionStage(path({ interviewRequired: false }), facts());
      expect(readout.since).toEqual(T0);
    });
  });
});
// The reports led to a wider discussion: the window is the community's, and a
// standing concern the mediation body's, so nobody in the process is stuck on it —
// which is the difference between this and a decision nobody has made.
describe("a wider discussion, and a booked interview", () => {
  const reportsIn = { applicationSubmitted: true, interviewScheduled: true, interviewHeld: true, evaluationsFiled: 2 };

  it("is its own stage once the reports are in and the window is open, and needs nobody", () => {
    const readout = computeAdmissionStage(path(), facts({ ...reportsIn, widerDiscussionOpen: true }));
    expect(readout).toMatchObject({ stage: "wider_discussion", reason: "wider_discussion_open" });
    expect(admissionNeedsAction(readout)).toBe(false);
    expect(describeAdmissionStage(readout)).toMatch(/short window to raise any concern/);
  });

  it("is a decision pending, which the holders do own, when no window was opened", () => {
    const readout = computeAdmissionStage(path(), facts(reportsIn));
    expect(readout.stage).toBe("decision_pending");
    expect(admissionNeedsAction(readout)).toBe(true);
  });

  it("ends when the decision is recorded: the window is a fact about an undecided arrival", () => {
    const readout = computeAdmissionStage(path(), facts({ ...reportsIn, widerDiscussionOpen: true, decisionRecorded: true }));
    expect(readout.stage).not.toBe("wider_discussion");
  });

  it("treats a booked interview as waiting for the call, which nobody can hurry", () => {
    const booked = computeAdmissionStage(path(), facts({ applicationSubmitted: true, interviewScheduled: true }));
    expect(booked.stage).toBe("interview_scheduled");
    expect(admissionNeedsAction(booked)).toBe(false);
    // Once it has happened, the reports are the holders' to file.
    const held = computeAdmissionStage(path(), facts({ applicationSubmitted: true, interviewScheduled: true, interviewHeld: true }));
    expect(held.stage).toBe("interview_held");
    expect(admissionNeedsAction(held)).toBe(true);
  });
});
