import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { member, task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import {
  archiveForm,
  createForm,
  getForm,
  getPostCycleFeedbackForm,
  listForms,
  listFormResponses,
  listPostCycleFeedbackResponses,
  submitFormResponse,
  submitPostCycleFeedback,
  formValuesFromFormData,
  type FormField,
  unarchiveForm,
  updateForm,
} from "@/lib/forms";
import { archiveProfileQuestion, createProfileQuestion } from "@/lib/profile-questions";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";
import { setPermissionGrant } from "@/lib/permissions";
import { createCycle } from "@/lib/cycles";

async function insertReviewTask(
  communityId: string,
  branchId: string,
  createdBy: string,
  cycleId?: string | null,
) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Review feedback responses",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 1 },
      createdBy,
      ...(cycleId !== undefined && { cycleId }),
    })
    .returning();
  return row;
}

const surveyFields = [
  { key: "overall", label: "How did this cycle go?", responseType: "text" as const, required: true },
  {
    key: "again",
    label: "Would you do it again?",
    responseType: "single_choice" as const,
    options: ["Yes", "No", "Maybe"],
    required: false,
  },
];

describe("Form CRUD", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a form with fields and lists it", async () => {
    const { alice } = await createFixtures();
    const created = await createForm(alice, {
      title: "Post-cycle survey",
      fields: surveyFields,
      allowAnonymous: true,
    });
    expect(created.title).toBe("Post-cycle survey");
    expect(created.allowAnonymous).toBe(true);
    expect(created.archivedAt).toBeNull();

    const forms = await listForms(alice);
    expect(forms.map((f) => f.id)).toEqual([created.id]);
  });

  it("rejects a choice field with no options", async () => {
    const { alice } = await createFixtures();
    await expect(
      createForm(alice, {
        title: "Bad form",
        fields: [{ key: "x", label: "X", responseType: "single_choice" }],
      } as never),
    ).rejects.toThrow();
  });

  it("updates title/description but leaves fields untouched when fields is omitted", async () => {
    const { alice } = await createFixtures();
    const created = await createForm(alice, { title: "Original", fields: surveyFields });
    const updated = await updateForm(alice, created.id, { title: "Renamed" });
    expect(updated.title).toBe("Renamed");
    expect(updated.fields).toEqual(surveyFields);
  });

  // docs/development-plan.md's Phase 58 — fields become genuinely
  // editable post-creation, the input path a real field-builder client
  // component now produces instead of the old pipe-delimited textarea.
  describe("Phase 58: editing fields post-creation", () => {
    it("can add, relabel, retype, and reorder fields on an existing form", async () => {
      const { alice } = await createFixtures();
      const created = await createForm(alice, { title: "Original", fields: surveyFields });

      const newFields = [
        { ...surveyFields[1], label: "Would you do it again? (renamed)" },
        surveyFields[0],
        { key: "new_field", label: "Anything else?", responseType: "text" as const, required: false },
      ];
      const updated = await updateForm(alice, created.id, { fields: newFields });
      expect(updated.fields).toEqual(newFields);
    });

    it("rejects an update introducing a choice field with no options", async () => {
      const { alice } = await createFixtures();
      const created = await createForm(alice, { title: "Original", fields: surveyFields });
      await expect(
        updateForm(alice, created.id, {
          fields: [{ key: "bad", label: "Bad", responseType: "single_choice" }] as never,
        }),
      ).rejects.toThrow();
    });

    it("rejects an update introducing duplicate keys", async () => {
      const { alice } = await createFixtures();
      const created = await createForm(alice, { title: "Original", fields: surveyFields });
      await expect(
        updateForm(alice, created.id, {
          fields: [
            { key: "dup", label: "One", responseType: "text" },
            { key: "dup", label: "Two", responseType: "text" },
          ],
        }),
      ).rejects.toThrow();
    });

    it("rejects an update tagging two fields as the name field", async () => {
      const { alice } = await createFixtures();
      const created = await createForm(alice, { title: "Original", fields: surveyFields });
      await expect(
        updateForm(alice, created.id, {
          fields: [
            { key: "a", label: "A", responseType: "text", isNameField: true },
            { key: "b", label: "B", responseType: "text", isNameField: true },
          ],
        }),
      ).rejects.toThrow();
    });

    it("editing fields never touches an existing FormResponse's own recorded values", async () => {
      const { alice } = await createFixtures();
      const created = await createForm(alice, { title: "Original", fields: surveyFields });
      await submitFormResponse(alice, created.id, { values: { overall: "Great", again: "Yes" } });

      await updateForm(alice, created.id, {
        fields: [{ key: "overall", label: "Renamed label", responseType: "text", required: true }],
      });

      const [response] = await listFormResponses(alice, created.id);
      expect(response.values).toEqual({ overall: "Great", again: "Yes" });
    });
  });

  it("archiving hides a form from the default list but not includeArchived", async () => {
    const { alice } = await createFixtures();
    const created = await createForm(alice, { title: "Old survey", fields: surveyFields });
    await archiveForm(alice, created.id);

    expect(await listForms(alice)).toHaveLength(0);
    const withArchived = await listForms(alice, { includeArchived: true });
    expect(withArchived).toHaveLength(1);
    expect(withArchived[0].archivedAt).not.toBeNull();

    const unarchived = await unarchiveForm(alice, created.id);
    expect(unarchived.archivedAt).toBeNull();
  });

  it("rejects operating on a form outside the actor's community", async () => {
    const { alice } = await createFixtures();
    const created = await createForm(alice, { title: "Survey", fields: surveyFields });

    const { alice: strangerAlice } = await createFixtures();
    await expect(getForm(strangerAlice, created.id)).rejects.toThrow(NotFoundError);
  });
});

// A Form submission used to be checked for required-and-blank and
// nothing else, which was survivable when a field could only be text or
// a choice and was not survivable the moment a form could hold a number
// with bounds, a yes/no, or an email. These cover the validation that now
// runs on every submission, through the same validateFieldValue a
// ProfileQuestion answer goes through.
describe("Form submissions validate against their fields", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a non-numeric answer to a number field", async () => {
    const { alice } = await createFixtures();
    const form = await createForm(alice, {
      title: "Crew details",
      fields: [{ key: "hours", label: "Hours a week", responseType: "number", required: true, max: 40 }],
    });

    const ok = await submitFormResponse(alice, form.id, { values: { hours: "12" } });
    expect(ok.values).toEqual({ hours: 12 });

    await expect(submitFormResponse(alice, form.id, { values: { hours: "banana" } })).rejects.toThrow(ConflictError);
    await expect(submitFormResponse(alice, form.id, { values: { hours: "60" } })).rejects.toThrow(/at most/);
  });

  it("rejects a malformed answer to a field with a format check", async () => {
    const { alice } = await createFixtures();
    const form = await createForm(alice, {
      title: "Contact",
      fields: [{ key: "email", label: "Email", responseType: "text", validation: "email", required: true }],
    });

    await expect(submitFormResponse(alice, form.id, { values: { email: "sam@example.com" } })).resolves.toBeTruthy();
    await expect(submitFormResponse(alice, form.id, { values: { email: "sam at example" } })).rejects.toThrow(/email/);
  });

  it("stores a boolean submission as a real boolean", async () => {
    const { alice } = await createFixtures();
    const form = await createForm(alice, {
      title: "Site needs",
      fields: [{ key: "bed", label: "Need a bed?", responseType: "boolean" }],
    });

    const no = await submitFormResponse(alice, form.id, { values: { bed: "false" } });
    expect(no.values).toEqual({ bed: false });
  });

  it("reads a choice field's escape-hatch text from its sibling input", async () => {
    const { alice } = await createFixtures();
    const form = await createForm(alice, {
      title: "About you",
      fields: [
        { key: "pronouns", label: "Pronouns", responseType: "single_choice", options: ["she/her", "they/them"], allowOther: true },
        { key: "needs", label: "What do you need?", responseType: "multi_choice", options: ["bed", "power"], allowOther: true },
      ],
    });

    // What a browser posts for "they/them" plus text in the other box.
    const fd = new FormData();
    fd.append("field_pronouns", "they/them");
    fd.append("field_pronouns__other", "xe/xem");
    fd.append("field_needs", "bed");
    fd.append("field_needs__other", "a tent pole");
    const values = formValuesFromFormData(form.fields as FormField[], fd);

    expect(values).toEqual({ pronouns: "they/them", needs: ["bed", "a tent pole"] });

    // A ticked real option outranks leftover text in the other box.
    const onlyOption = new FormData();
    onlyOption.append("field_pronouns", "they/them");
    onlyOption.append("field_pronouns__other", "leftover typing");
    expect(formValuesFromFormData(form.fields as FormField[], onlyOption)).toMatchObject({
      pronouns: "they/them",
    });
  });

  it("rejects free text on a choice field with no escape hatch", async () => {
    const { alice } = await createFixtures();
    const form = await createForm(alice, {
      title: "About you",
      fields: [{ key: "pronouns", label: "Pronouns", responseType: "single_choice", options: ["she/her"] }],
    });
    await expect(submitFormResponse(alice, form.id, { values: { pronouns: "xe/xem" } })).rejects.toThrow(ConflictError);
  });
});

// mapsToProfileQuestionId: a Form field can name which once-ever
// ProfileQuestion its own answer should seed at applicant→Member
// conversion (src/lib/recruitment/decisions.ts's
// maybeConvertApplicantToMember) — see docs/development-plan.md's own
// generalization of isNameField/isEmailField past just name/email.
describe("Form fields: mapsToProfileQuestionId", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("accepts a field mapped to a once_ever profile question in the same community", async () => {
    const { alice } = await createFixtures();
    const pronouns = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "text",
      scope: "once_ever",
    });
    const created = await createForm(alice, {
      title: "Application",
      fields: [{ key: "pronouns", label: "Pronouns", responseType: "text", mapsToProfileQuestionId: pronouns.id }],
    });
    expect(created.fields).toEqual([
      { key: "pronouns", label: "Pronouns", responseType: "text", mapsToProfileQuestionId: pronouns.id },
    ]);
  });

  it("rejects two fields mapped to the same profile question", async () => {
    const { alice } = await createFixtures();
    const pronouns = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "text",
      scope: "once_ever",
    });
    await expect(
      createForm(alice, {
        title: "Bad form",
        fields: [
          { key: "a", label: "A", responseType: "text", mapsToProfileQuestionId: pronouns.id },
          { key: "b", label: "B", responseType: "text", mapsToProfileQuestionId: pronouns.id },
        ],
      }),
    ).rejects.toThrow(/at most one field can map to the same profile question/);
  });

  it("rejects a field mapped to a per_cycle-scoped profile question", async () => {
    const { alice } = await createFixtures();
    const availability = await createProfileQuestion(alice, {
      label: "Availability",
      responseType: "text",
      scope: "per_cycle",
    });
    await expect(
      createForm(alice, {
        title: "Bad form",
        fields: [{ key: "a", label: "A", responseType: "text", mapsToProfileQuestionId: availability.id }],
      }),
    ).rejects.toThrow(/once-ever/);
  });

  it("rejects a field mapped to an archived profile question", async () => {
    const { alice } = await createFixtures();
    const pronouns = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "text",
      scope: "once_ever",
    });
    await archiveProfileQuestion(alice, pronouns.id);
    await expect(
      createForm(alice, {
        title: "Bad form",
        fields: [{ key: "a", label: "A", responseType: "text", mapsToProfileQuestionId: pronouns.id }],
      }),
    ).rejects.toThrow(/no longer exists/);
  });

  it("rejects a field mapped to a profile question from a different community", async () => {
    const { alice } = await createFixtures();
    const { alice: strangerAlice } = await createFixtures();
    const strangerQuestion = await createProfileQuestion(strangerAlice, {
      label: "Pronouns",
      responseType: "text",
      scope: "once_ever",
    });
    await expect(
      createForm(alice, {
        title: "Bad form",
        fields: [{ key: "a", label: "A", responseType: "text", mapsToProfileQuestionId: strangerQuestion.id }],
      }),
    ).rejects.toThrow(/no longer exists/);
  });

  it("also validates mappedProfileQuestionId on update", async () => {
    const { alice } = await createFixtures();
    const created = await createForm(alice, { title: "Original", fields: surveyFields });
    await expect(
      updateForm(alice, created.id, {
        fields: [{ key: "x", label: "X", responseType: "text", mapsToProfileQuestionId: crypto.randomUUID() }],
      }),
    ).rejects.toThrow(/no longer exists/);
  });
});

describe("submitting responses", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("records the submitter by default", async () => {
    const { alice } = await createFixtures();
    const created = await createForm(alice, { title: "Survey", fields: surveyFields });
    const response = await submitFormResponse(alice, created.id, {
      values: { overall: "Great!", again: "Yes" },
    });
    expect(response.submittedBy).toBe(alice.id);
    expect(response.values).toEqual({ overall: "Great!", again: "Yes" });
  });

  it("records anonymously only when the form allows it and the submitter opts in", async () => {
    const { alice, bob } = await createFixtures();
    const openForm = await createForm(alice, { title: "Open", fields: surveyFields, allowAnonymous: true });
    const closedForm = await createForm(alice, { title: "Closed", fields: surveyFields, allowAnonymous: false });

    const anon = await submitFormResponse(bob, openForm.id, {
      values: { overall: "fine" },
      anonymous: true,
    });
    expect(anon.submittedBy).toBeNull();

    const notAnon = await submitFormResponse(bob, closedForm.id, {
      values: { overall: "fine" },
      anonymous: true,
    });
    expect(notAnon.submittedBy).toBe(bob.id);
  });

  it("rejects a submission missing a required field", async () => {
    const { alice } = await createFixtures();
    const created = await createForm(alice, { title: "Survey", fields: surveyFields });
    await expect(
      submitFormResponse(alice, created.id, { values: { again: "Yes" } }),
    ).rejects.toThrow(AppError);
  });

  it("rejects submitting to an archived form", async () => {
    const { alice } = await createFixtures();
    const created = await createForm(alice, { title: "Survey", fields: surveyFields });
    await archiveForm(alice, created.id);
    await expect(
      submitFormResponse(alice, created.id, { values: { overall: "hi" } }),
    ).rejects.toThrow(ConflictError);
  });

  it("listFormResponses is community-scoped only, not reviewer-gated", async () => {
    const { alice, bob } = await createFixtures();
    const created = await createForm(alice, { title: "Survey", fields: surveyFields });
    await submitFormResponse(bob, created.id, { values: { overall: "hi" } });

    const responses = await listFormResponses(alice, created.id);
    expect(responses).toHaveLength(1);
  });
});

describe("post-cycle feedback consumer", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("getPostCycleFeedbackForm is null until one is configured", async () => {
    const { alice } = await createFixtures();
    expect(await getPostCycleFeedbackForm(alice)).toBeNull();
  });

  it("submitPostCycleFeedback rejects when no form is configured", async () => {
    const { alice } = await createFixtures();
    await expect(submitPostCycleFeedback(alice, { values: {} })).rejects.toThrow(AppError);
  });

  it("full flow: configure a form and review task, submit, and review", async () => {
    const { alice, bob, branch: testBranch } = await createFixtures();
    const surveyForm = await createForm(alice, { title: "Survey", fields: surveyFields, allowAnonymous: true });
    const reviewTask = await insertReviewTask(alice.communityId, testBranch.id, alice.id);
    await claimTask(alice, reviewTask.id);

    await updateCommunity(alice, { postCycleFeedbackFormId: surveyForm.id });
    await grantPermission(alice.communityId, "feedback_review", reviewTask.id);

    const refetchedAlice = (await db.select().from(member).where(eq(member.id, alice.id)))[0];

    const configured = await getPostCycleFeedbackForm(refetchedAlice);
    expect(configured?.id).toBe(surveyForm.id);

    await submitPostCycleFeedback(bob, { values: { overall: "Went well", again: "Yes" } });

    // bob doesn't hold the review task — forbidden.
    await expect(listPostCycleFeedbackResponses(bob)).rejects.toThrow(ForbiddenError);

    const responses = await listPostCycleFeedbackResponses(refetchedAlice);
    expect(responses).toHaveLength(1);
    expect(responses[0].values).toEqual({ overall: "Went well", again: "Yes" });
  });

  it("listPostCycleFeedbackResponses is empty, not an error, when nothing is configured", async () => {
    const { alice } = await createFixtures();
    expect(await listPostCycleFeedbackResponses(alice)).toEqual([]);
  });

  it("rejects configuring a form or task from another community", async () => {
    const { alice } = await createFixtures();
    const { alice: strangerAlice, branch: strangerBranch } = await createFixtures();
    const strangerForm = await createForm(strangerAlice, { title: "Foreign", fields: surveyFields });
    const strangerTask = await insertReviewTask(strangerAlice.communityId, strangerBranch.id, strangerAlice.id);

    await expect(
      updateCommunity(alice, { postCycleFeedbackFormId: strangerForm.id }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      setPermissionGrant(alice.communityId, "feedback_review", strangerTask.id),
    ).rejects.toThrow(NotFoundError);
  });
});

// docs/cycle-scope-remediation-plan.md §4.3 (the feedback_review half)
// — formResponse.cycle_id lands, so a feedback_review task placed in a
// cycle reviews that cycle's responses while a cycle-less one reviews
// everything. The reviewer resolves scope from their own task's
// placement, the same per-cycle resolver shape spatial-planning already
// uses.
describe("post-cycle feedback is cycle-scoped (§4.3)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function setUpCycleFeedback() {
    const fixtures = await createFixtures();
    const surveyForm = await createForm(fixtures.alice, {
      title: "Survey",
      fields: surveyFields,
      allowAnonymous: true,
    });
    await updateCommunity(fixtures.alice, { postCycleFeedbackFormId: surveyForm.id, cyclesEnabled: true });
    const springCycle = await createCycle(fixtures.alice, { source: "blank", name: "Spring 2026" });
    const summerCycle = await createCycle(fixtures.alice, { source: "blank", name: "Summer 2026", confirmed: true });
    return { ...fixtures, surveyForm, springCycle, summerCycle };
  }

  const overallOf = (r: { values: unknown }) => (r.values as Record<string, unknown>).overall;

  it("records the cycle a response is about, defaulting to null", async () => {
    const { bob, springCycle } = await setUpCycleFeedback();

    const tagged = await submitPostCycleFeedback(bob, { values: { overall: "Great" }, cycleId: springCycle.id });
    expect(tagged.cycleId).toBe(springCycle.id);

    const untagged = await submitPostCycleFeedback(bob, { values: { overall: "General note" } });
    expect(untagged.cycleId).toBeNull();
  });

  it("rejects tagging a response with a cycle from another community", async () => {
    const { bob } = await setUpCycleFeedback();
    const { alice: strangerAlice } = await createFixtures();
    await updateCommunity(strangerAlice, { cyclesEnabled: true });
    const strangerCycle = await createCycle(strangerAlice, { source: "blank", name: "Elsewhere 2026" });

    await expect(
      submitPostCycleFeedback(bob, { values: { overall: "x" }, cycleId: strangerCycle.id }),
    ).rejects.toThrow(NotFoundError);
  });

  it("scopes each reviewer to their task's placement: one cycle, or every response for cycle-less", async () => {
    const { alice, bob, branch, springCycle, summerCycle } = await setUpCycleFeedback();

    await submitPostCycleFeedback(bob, { values: { overall: "Spring report" }, cycleId: springCycle.id });
    await submitPostCycleFeedback(bob, { values: { overall: "Summer report" }, cycleId: summerCycle.id });
    await submitPostCycleFeedback(bob, { values: { overall: "General note" } });

    // Not a holder of any feedback_review task — forbidden.
    await expect(listPostCycleFeedbackResponses(alice)).rejects.toThrow(ForbiddenError);

    // Spring's reviewer: the spring-tagged response only — not summer's,
    // and not the untagged general one (that belongs to the
    // community/evergreen scope).
    const springTask = await insertReviewTask(alice.communityId, branch.id, alice.id, springCycle.id);
    await claimTask(alice, springTask.id);
    await grantPermission(alice.communityId, "feedback_review", springTask.id);
    const springResponses = await listPostCycleFeedbackResponses(alice);
    expect(springResponses.map(overallOf)).toEqual(["Spring report"]);

    // Summer's own reviewer coexists (single cardinality is per scope),
    // seeing exactly summer's response.
    const summerTask = await insertReviewTask(alice.communityId, branch.id, bob.id, summerCycle.id);
    await claimTask(bob, summerTask.id);
    await grantPermission(alice.communityId, "feedback_review", summerTask.id);
    const summerResponses = await listPostCycleFeedbackResponses(bob);
    expect(summerResponses.map(overallOf)).toEqual(["Summer report"]);
  });

  it("a cycle-less (evergreen) reviewer sees every response, cycle-tagged or not", async () => {
    const { alice, bob, branch, springCycle, summerCycle } = await setUpCycleFeedback();

    await submitPostCycleFeedback(bob, { values: { overall: "Spring report" }, cycleId: springCycle.id });
    await submitPostCycleFeedback(bob, { values: { overall: "Summer report" }, cycleId: summerCycle.id });
    await submitPostCycleFeedback(bob, { values: { overall: "General note" } });

    const communityTask = await insertReviewTask(alice.communityId, branch.id, alice.id);
    await claimTask(alice, communityTask.id);
    await grantPermission(alice.communityId, "feedback_review", communityTask.id);

    const responses = await listPostCycleFeedbackResponses(alice);
    expect(responses).toHaveLength(3);
  });
});
