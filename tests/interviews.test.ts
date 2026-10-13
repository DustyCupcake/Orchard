import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admission, community, cycle, member, recruitmentStandingAvailability, schedulingEntry, schedulingPoll, task } from "@/db/schema";
import { createFixtures, grantPermission, insertTask, resetDatabase, setLanes, POLICY_TWO_OF_TWO } from "./helpers";
import { claimTask } from "@/lib/tasks";
import { createForm } from "@/lib/forms";
import { updateCommunity } from "@/lib/settings";
import { createCycle, updateCycleSettings } from "@/lib/cycles";
import { confirmSlot, getPollAggregate, submitAvailability } from "@/lib/scheduling-polls";
import {
  confirmInterview,
  createCommunityInvite,
  getArrivalByToken,
  getInterviewAvailability,
  getInterviewers,
  getInterviewState,
  getRecruitmentPipeline,
  markInterviewHeld,
  recordDecisionIfReached,
  redeemCommunityInvite,
  setStandingAvailability,
  submitEvaluation,
  submitInterviewAvailability,
  submitRecruitmentApplication,
  ensureInterviewPoll,
} from "@/lib/recruitment";
import { ConflictError, ForbiddenError } from "@/lib/errors";

// docs/plans/admission-flow.md §2, "Interview". The interview comes before the decision:
// a poll is made for each arrival whose lane asks for one, the person and the
// holders say when they're free (the holders standing, or on this poll), a slot
// qualifies when the person overlaps and at least N holders offered it, a holder —
// any holder — confirms, the interviewers are whoever offered that slot, and the
// reports the decision is made from are theirs.

const fields = [
  { key: "name", label: "Name", responseType: "text" as const, required: true, isNameField: true },
  { key: "email", label: "Email", responseType: "text" as const, required: true, isEmailField: true },
];

// Two holders (alice, bob) on one recruitment task, an interview lane that needs
// two reports, and a third member who holds nothing.
async function setUp(opts: { holders?: ("alice" | "bob")[]; withTask?: boolean } = {}) {
  const fixtures = await createFixtures();
  const { community: c, alice, bob, branch } = fixtures;
  await db.update(community).set({ modulesEnabled: ["recruitment"], cyclesEnabled: true }).where(eq(community.id, c.id));
  const [carol] = await db.insert(member).values({ communityId: c.id, name: "Carol" }).returning();
  const form = await createForm(alice, { title: "Application", fields });
  await updateCommunity(alice, { recruitmentApplicationFormId: form.id, ...POLICY_TWO_OF_TWO });
  await setLanes(c.id, [
    { name: "Invited", kind: "invite", handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true, applicationRequired: false, interviewRequired: true },
    { name: "Open", kind: "public", interviewRequired: true },
  ]);
  const recruitmentTask = opts.withTask === false ? null : await insertTask(c.id, branch.id, alice.id, { capacity: 2 });
  if (recruitmentTask) {
    await grantPermission(c.id, "recruitment", recruitmentTask.id);
    const who = opts.holders ?? ["alice", "bob"];
    if (who.includes("alice")) await claimTask(alice, recruitmentTask.id);
    if (who.includes("bob")) await claimTask(bob, recruitmentTask.id);
  }
  const apply = (name = "Dana") =>
    submitRecruitmentApplication(c.id, { values: { name, email: `${name.toLowerCase()}@example.com` } });
  const arrivalOf = async (arrivalId: string) => (await db.select().from(admission).where(eq(admission.id, arrivalId)))[0];
  return { ...fixtures, carol, form, recruitmentTask, apply, arrivalOf };
}

const inDays = (days: number, hour = 10) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

describe("the interview poll is made as the person enters", () => {
  beforeEach(resetDatabase);

  it("for an application, with the lane's reports as N and the person as the one required participant", async () => {
    const { apply, arrivalOf } = await setUp();
    const application = await apply();
    const arrival = await arrivalOf(application.arrivalId);
    expect(arrival.interviewPollId).not.toBeNull();
    const [poll] = await db.select().from(schedulingPoll).where(eq(schedulingPoll.id, arrival.interviewPollId!));
    expect(poll).toMatchObject({ resolutionMode: "person_plus_n_holders", minAttendance: 2, title: "Interview: Dana" });
    // Holders are read live, so none is frozen into the poll.
    expect(poll.requiredParticipantIds).toEqual([arrival.id]);
  });

  it("for an invitee on an interview-only lane, who has no application at all", async () => {
    const { alice, arrivalOf } = await setUp();
    const invite = await createCommunityInvite(alice, {});
    const outcome = await redeemCommunityInvite(invite.token, { email: "eve@example.com" });
    // The "Invited" lane in this fixture asks for no application and an interview.
    if (outcome.kind !== "waiting") throw new Error(`expected waiting, got ${outcome.kind}`);
    const arrival = await arrivalOf(outcome.arrivalId);
    expect(arrival.formResponseId).toBeNull();
    expect(arrival.interviewPollId).not.toBeNull();
  });

  it("holds the arrival at the interview step while the door is shut, and makes the poll when it reopens", async () => {
    const { community: c, alice, apply, arrivalOf } = await setUp();
    await db.update(community).set({ recruitmentInterviewsOpen: false }).where(eq(community.id, c.id));
    const application = await apply();
    expect((await arrivalOf(application.arrivalId)).interviewPollId).toBeNull();

    // Held, never skipped: it is the holders' to notice, and the person is told nothing yet.
    const candidate = (await getRecruitmentPipeline(alice)).candidates.find((x) => x.id === application.arrivalId)!;
    expect(candidate.actionLabel).toMatch(/Interview not set up/);

    await updateCommunity(alice, { recruitmentInterviewsOpen: true });
    expect((await arrivalOf(application.arrivalId)).interviewPollId).not.toBeNull();
  });

  it("holds an event's arrivals the same way when that event's interviews door is shut", async () => {
    const { community: c, alice, arrivalOf } = await setUp();
    const ev = await createCycle(alice, { source: "blank", name: "Season" });
    await updateCycleSettings(alice, ev.id, { interviewsOpen: false });
    const application = await submitRecruitmentApplication(c.id, { values: { name: "Dana", email: "dana@example.com" }, cycleId: ev.id });
    expect((await arrivalOf(application.arrivalId)).interviewPollId).toBeNull();
    await updateCycleSettings(alice, ev.id, { interviewsOpen: true });
    expect((await arrivalOf(application.arrivalId)).interviewPollId).not.toBeNull();
  });

  it("is reported rather than invented when there is no recruitment task to file it under", async () => {
    const { apply, arrivalOf } = await setUp({ withTask: false });
    const application = await apply();
    const arrival = await arrivalOf(application.arrivalId);
    expect(arrival.interviewPollId).toBeNull();
    expect(await ensureInterviewPoll(arrival.id)).toBeNull();
  });

  it("is made once, however often it's asked for", async () => {
    const { apply, arrivalOf } = await setUp();
    const application = await apply();
    const first = (await arrivalOf(application.arrivalId)).interviewPollId;
    expect((await ensureInterviewPoll(application.arrivalId))?.id).toBe(first);
    expect(await db.select().from(schedulingPoll)).toHaveLength(1);
  });
});

describe("a slot qualifies when the person overlaps and at least N holders offered it", () => {
  beforeEach(resetDatabase);

  it("needs the person AND two holders, and ignores people who aren't holders", async () => {
    const { alice, bob, carol, apply, arrivalOf } = await setUp();
    const application = await apply();
    const arrival = await arrivalOf(application.arrivalId);
    const slot = inDays(2);

    await submitAvailability(alice, arrival.interviewPollId!, { slots: [slot] });
    await submitAvailability(bob, arrival.interviewPollId!, { slots: [slot] });
    // Two holders offered it, but the person hasn't.
    expect((await getInterviewState(arrival)).qualifyingSlots).toEqual([]);

    await submitInterviewAvailability(arrival, [slot]);
    expect((await getInterviewState(arrival)).qualifyingSlots).toEqual([slot]);

    // A member who holds nothing offering it counts for nothing: N is *holders*.
    const other = inDays(3);
    await submitAvailability(carol, arrival.interviewPollId!, { slots: [other] });
    await submitAvailability(alice, arrival.interviewPollId!, { slots: [slot, other] });
    await submitInterviewAvailability(arrival, [slot, other]);
    expect((await getInterviewState(arrival)).qualifyingSlots).toEqual([slot]);
  });

  it("reads standing availability live — nothing is copied, and a holder who comes back rescues the poll", async () => {
    const { alice, bob, apply, arrivalOf } = await setUp();
    const application = await apply();
    const arrival = await arrivalOf(application.arrivalId);
    const slot = inDays(2);
    await submitInterviewAvailability(arrival, [slot]);

    await setStandingAvailability(alice.id, [slot]);
    expect((await getInterviewState(arrival)).qualifyingSlots).toEqual([]); // one holder is not two

    // Bob was away when the poll was made. He fills in his standing week now.
    await setStandingAvailability(bob.id, [slot]);
    expect((await getInterviewState(arrival)).qualifyingSlots).toEqual([slot]);
    // And nothing was written onto the poll to make that so.
    expect(await db.select().from(schedulingEntry).where(eq(schedulingEntry.pollId, arrival.interviewPollId!))).toHaveLength(1);
  });

  it("keeps a standing grid to the next two weeks, and ignores one that has lapsed", async () => {
    const { alice, apply, arrivalOf } = await setUp();
    const near = inDays(3);
    const far = inDays(40);
    const row = await setStandingAvailability(alice.id, [near, far, near]);
    expect(row.availableSlots).toEqual([near]);

    const application = await apply();
    const arrival = await arrivalOf(application.arrivalId);
    await submitInterviewAvailability(arrival, [near]);
    await setStandingAvailability((await db.select().from(member).where(eq(member.name, "Bob")))[0].id, [near]);
    expect((await getInterviewState(arrival)).qualifyingSlots).toEqual([near]);

    // Nobody refreshed it for longer than its window: it offers nothing now.
    await db
      .update(recruitmentStandingAvailability)
      .set({ windowEnd: new Date(Date.now() - 1000) })
      .where(eq(recruitmentStandingAvailability.memberId, alice.id));
    expect((await getInterviewState(arrival)).qualifyingSlots).toEqual([]);
  });

  it("lets the person change their times until one is confirmed, and not after", async () => {
    const { alice, bob, apply, arrivalOf } = await setUp();
    const application = await apply();
    const arrival = await arrivalOf(application.arrivalId);
    const slot = inDays(2);
    await submitInterviewAvailability(arrival, [slot]);
    await submitInterviewAvailability(arrival, [slot, inDays(3)]);
    expect(await getInterviewAvailability(arrival)).toEqual([slot, inDays(3)]);

    await submitAvailability(alice, arrival.interviewPollId!, { slots: [slot] });
    await submitAvailability(bob, arrival.interviewPollId!, { slots: [slot] });
    await confirmInterview(alice, arrival.id, slot);
    await expect(submitInterviewAvailability(arrival, [inDays(4)])).rejects.toThrow(ConflictError);
  });
});

describe("confirmation is a person, and the interviewers are whoever offered the slot", () => {
  beforeEach(resetDatabase);

  async function readyToBook() {
    const s = await setUp();
    const application = await s.apply();
    const arrival = await s.arrivalOf(application.arrivalId);
    const slot = inDays(2);
    await submitAvailability(s.alice, arrival.interviewPollId!, { slots: [slot] });
    await submitAvailability(s.bob, arrival.interviewPollId!, { slots: [slot] });
    await submitInterviewAvailability(arrival, [slot]);
    return { ...s, application, arrival, slot };
  }

  it("lets any holder confirm — not only whoever organized the poll — and refuses anyone else", async () => {
    const { alice, bob, carol, arrival, arrivalOf, slot } = await readyToBook();
    const [poll] = await db.select().from(schedulingPoll).where(eq(schedulingPoll.id, arrival.interviewPollId!));
    // Whichever holder organized the poll, the *other* one confirms it.
    const confirmer = poll.organizedBy === alice.id ? bob : alice;
    await expect(confirmInterview(carol, arrival.id, slot)).rejects.toThrow(ForbiddenError);
    await confirmInterview(confirmer, arrival.id, slot);

    const booked = await arrivalOf(arrival.id);
    expect(booked.interviewScheduledAt).not.toBeNull();
    expect(booked.interviewHeldAt).toBeNull(); // the slot is still ahead
    const [confirmedPoll] = await db.select().from(schedulingPoll).where(eq(schedulingPoll.id, arrival.interviewPollId!));
    expect(confirmedPoll.confirmedBy).toBe(confirmer.id);
  });

  it("only books a slot that qualifies as things stand this moment", async () => {
    const { alice, arrival, slot } = await readyToBook();
    await expect(confirmInterview(alice, arrival.id, inDays(9))).rejects.toThrow(/doesn't suit/);
    await confirmInterview(alice, arrival.id, slot);
    await expect(confirmInterview(alice, arrival.id, slot)).rejects.toThrow(/already been confirmed/);
  });

  it("also works through the scheduling page's own confirm, which a non-organizer holder may now use", async () => {
    const { bob, arrival, arrivalOf, slot } = await readyToBook();
    await confirmSlot(bob, arrival.interviewPollId!, { slot });
    expect((await arrivalOf(arrival.id)).interviewScheduledAt).not.toBeNull();
  });

  it("derives the interviewers from who offered the confirmed slot, standing or on the poll", async () => {
    const s = await setUp();
    const application = await s.apply();
    const arrival = await s.arrivalOf(application.arrivalId);
    const slot = inDays(2);
    await setStandingAvailability(s.alice.id, [slot]); // standing
    await submitAvailability(s.bob, arrival.interviewPollId!, { slots: [slot] }); // on the poll
    await submitInterviewAvailability(arrival, [slot]);
    await confirmInterview(s.alice, arrival.id, slot);
    expect((await getInterviewers(await s.arrivalOf(arrival.id))).map((m) => m.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("derives who took part from the slot that was booked: a holder who offered a different time did not", async () => {
    const s = await setUp();
    await db.update(task).set({ capacity: 3 }).where(eq(task.communityId, s.community.id));
    const [dave] = await db.insert(member).values({ communityId: s.community.id, name: "Dave" }).returning();
    await claimTask(dave, s.recruitmentTask!.id);
    const application = await s.apply();
    const arrival = await s.arrivalOf(application.arrivalId);
    const slot = inDays(2);
    await submitAvailability(s.alice, arrival.interviewPollId!, { slots: [slot] });
    await submitAvailability(s.bob, arrival.interviewPollId!, { slots: [slot] });
    await submitAvailability(dave, arrival.interviewPollId!, { slots: [inDays(5)] });
    await submitInterviewAvailability(arrival, [slot, inDays(5)]);
    await confirmInterview(s.alice, arrival.id, slot);
    expect((await getInterviewers(await s.arrivalOf(arrival.id))).map((m) => m.name).sort()).toEqual(["Alice", "Bob"]);
  });
});

describe("reports come after the interview, from the people who took part", () => {
  beforeEach(resetDatabase);

  async function bookedAndHeld(slotInThePast = false) {
    const s = await setUp();
    const application = await s.apply();
    const arrival = await s.arrivalOf(application.arrivalId);
    const slot = slotInThePast ? inDays(-1) : inDays(2);
    await submitAvailability(s.alice, arrival.interviewPollId!, { slots: [slot] });
    await submitAvailability(s.bob, arrival.interviewPollId!, { slots: [slot] });
    await submitInterviewAvailability(arrival, [slot]);
    await confirmInterview(s.alice, arrival.id, slot);
    return { ...s, application, arrival, slot };
  }

  it("refuses a report before the call has happened, with the reason", async () => {
    const { alice, application } = await bookedAndHeld();
    await expect(submitEvaluation(alice, application.formResponse.id, { recommendation: "proceed" })).rejects.toThrow(/hasn't happened yet/);
  });

  it("lets an interviewer say it happened, and then only the interviewers may report", async () => {
    const { alice, bob, carol, application, arrival, arrivalOf } = await bookedAndHeld();
    await expect(markInterviewHeld(carol, arrival.id)).rejects.toThrow(ForbiddenError);
    await markInterviewHeld(alice, arrival.id);
    expect((await arrivalOf(arrival.id)).interviewHeldAt).not.toBeNull();

    // Carol holds nothing, so she can't report at all; and a holder who wasn't on the
    // call is covered by the next test.
    await expect(submitEvaluation(carol, application.formResponse.id, { recommendation: "proceed" })).rejects.toThrow(/recruitment-task holder/);
    await submitEvaluation(alice, application.formResponse.id, { recommendation: "proceed" });
    await submitEvaluation(bob, application.formResponse.id, { recommendation: "proceed" });
    // The reports are in, and the decision follows from them: admitted.
    const decision = await recordDecisionIfReached(alice, application.formResponse.id);
    expect(decision).toMatchObject({ ruleOutcome: "proceed", resolution: "accepted" });
    expect((await arrivalOf(arrival.id)).admittedMemberId).not.toBeNull();
  });

  it("treats the slot passing as the call having been held, with no one needing to say so", async () => {
    // A call booked for yesterday: the slot has passed, so it happened.
    const { alice, application, arrival, arrivalOf } = await bookedAndHeld(true);
    const filed = await submitEvaluation(alice, application.formResponse.id, { recommendation: "proceed" });
    expect(filed.recommendation).toBe("proceed");
    expect((await arrivalOf(arrival.id)).interviewHeldAt).not.toBeNull();
  });

  it("counts reports per arrival, so each person's own N is needed", async () => {
    const s = await setUp();
    const first = await s.apply("Dana");
    const second = await s.apply("Eli");
    const slot = inDays(2);
    for (const a of [first, second]) {
      const arrival = await s.arrivalOf(a.arrivalId);
      await submitAvailability(s.alice, arrival.interviewPollId!, { slots: [slot] });
      await submitAvailability(s.bob, arrival.interviewPollId!, { slots: [slot] });
      await submitInterviewAvailability(arrival, [slot]);
      await confirmInterview(s.alice, arrival.id, slot);
      await markInterviewHeld(s.alice, arrival.id);
    }
    await submitEvaluation(s.alice, first.formResponse.id, { recommendation: "proceed" });
    await submitEvaluation(s.bob, first.formResponse.id, { recommendation: "proceed" });
    // Two reports resolved Dana. Eli has none, and is not credited with Dana's.
    expect(await recordDecisionIfReached(s.alice, first.formResponse.id)).toMatchObject({ resolution: "accepted" });
    expect(await recordDecisionIfReached(s.alice, second.formResponse.id)).toBeNull();
  });
});

describe("what the holders see while it happens", () => {
  beforeEach(resetDatabase);

  it("says who it is waiting on at every step", async () => {
    const s = await setUp();
    const application = await s.apply();
    const label = async () => (await getRecruitmentPipeline(s.alice)).candidates.find((c) => c.id === application.arrivalId)!;
    const arrival = await s.arrivalOf(application.arrivalId);
    const slot = inDays(2);

    // Waiting on the person: not the community's to chase.
    expect(await label()).toMatchObject({ stage: "application_submitted", needsAction: false });

    await submitInterviewAvailability(arrival, [slot]);
    expect(await label()).toMatchObject({ needsAction: true, actionLabel: "Interview needs more of you to offer times" });

    await submitAvailability(s.alice, arrival.interviewPollId!, { slots: [slot] });
    await submitAvailability(s.bob, arrival.interviewPollId!, { slots: [slot] });
    expect(await label()).toMatchObject({ needsAction: true, actionLabel: "Interview ready to book" });

    await confirmInterview(s.alice, arrival.id, slot);
    // Booked and waiting for the call: nobody has anything to do.
    expect(await label()).toMatchObject({ stage: "interview_scheduled", needsAction: false });

    await markInterviewHeld(s.alice, arrival.id);
    expect(await label()).toMatchObject({ stage: "interview_held", needsAction: true, actionLabel: "Reports needed (0 of 2)" });
  });
});

void getArrivalByToken;
void getPollAggregate;
