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
  unarchiveForm,
  updateForm,
} from "@/lib/forms";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";
import { setPermissionGrant } from "@/lib/permissions";

async function insertReviewTask(communityId: string, branchId: string, createdBy: string) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Review feedback responses",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 1 },
      createdBy,
    })
    .returning();
  return row;
}

const surveyFields = [
  { key: "overall", label: "How did this cycle go?", responseType: "free_text" as const, required: true },
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
        { key: "new_field", label: "Anything else?", responseType: "free_text" as const, required: false },
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
            { key: "dup", label: "One", responseType: "free_text" },
            { key: "dup", label: "Two", responseType: "free_text" },
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
            { key: "a", label: "A", responseType: "free_text", isNameField: true },
            { key: "b", label: "B", responseType: "free_text", isNameField: true },
          ],
        }),
      ).rejects.toThrow();
    });

    it("editing fields never touches an existing FormResponse's own recorded values", async () => {
      const { alice } = await createFixtures();
      const created = await createForm(alice, { title: "Original", fields: surveyFields });
      await submitFormResponse(alice, created.id, { values: { overall: "Great", again: "Yes" } });

      await updateForm(alice, created.id, {
        fields: [{ key: "overall", label: "Renamed label", responseType: "free_text", required: true }],
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
