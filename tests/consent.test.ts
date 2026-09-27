import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createConsentPurpose,
  deleteConsentPurpose,
  grantConsent,
  hasActiveConsent,
  listConsentPurposes,
  listMyConsentStatus,
  withdrawConsent,
  getGatingPurposesForQuestions,
} from "@/lib/consent";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { db } from "@/db";
import { profileQuestion } from "@/db/schema";
import { createFixtures, resetDatabase } from "./helpers";

/** A question for a consent purpose to gate. */
async function aQuestion(communityId: string, label = "Allergies") {
  const [q] = await db
    .insert(profileQuestion)
    .values({ communityId, label, responseType: "text", scope: "once_ever" })
    .returning();
  return q;
}

describe("consent purposes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a purpose and lists it for the community", async () => {
    const { alice } = await createFixtures();
    const created = await createConsentPurpose(alice, {
      key: "photo_publication",
      label: "Photo publication",
      noticeText: "We may publish event photos including you.",
    });
    expect(created.noticeVersion).toBe(1);
    expect(created.requiresExplicit).toBe(false);

    const purposes = await listConsentPurposes(alice);
    expect(purposes).toHaveLength(1);
  });

  it("rejects a duplicate key within the same community", async () => {
    const { alice } = await createFixtures();
    await createConsentPurpose(alice, { key: "marketing_comms", label: "Marketing", noticeText: "..." });
    await expect(
      createConsentPurpose(alice, { key: "marketing_comms", label: "Marketing again", noticeText: "..." }),
    ).rejects.toThrow(ConflictError);
  });

  it("requires explicit consent for anything gating a question", async () => {
    // The Art. 9 floor, unchanged by the column question going away: a
    // purpose that gates somebody's health or dietary answer may not be
    // something a member is taken to have agreed to by submitting a form.
    const { alice, community } = await createFixtures();
    const question = await aQuestion(community.id);
    await expect(
      createConsentPurpose(alice, {
        key: "sensitive_health",
        label: "Health data",
        noticeText: "...",
        gatesQuestionId: question.id,
        requiresExplicit: false,
      }),
    ).rejects.toThrow(AppError);

    const created = await createConsentPurpose(alice, {
      key: "sensitive_health",
      label: "Health data",
      noticeText: "...",
      gatesQuestionId: question.id,
      requiresExplicit: true,
    });
    expect(created.gatesQuestionId).toBe(question.id);
  });

  it("rejects a second purpose gating the same question", async () => {
    // Two purposes gating one answer means the member has to work out
    // which notice authorises the read, and a stale grant against the
    // wrong one becomes indistinguishable from a live one.
    const { alice, community } = await createFixtures();
    const question = await aQuestion(community.id);
    await createConsentPurpose(alice, {
      key: "sensitive_health",
      label: "Health data",
      noticeText: "...",
      gatesQuestionId: question.id,
      requiresExplicit: true,
    });
    await expect(
      createConsentPurpose(alice, {
        key: "sensitive_health_2",
        label: "Health data again",
        noticeText: "...",
        gatesQuestionId: question.id,
        requiresExplicit: true,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects a purpose gating a question from another community, or an archived one", async () => {
    const { alice, community } = await createFixtures();
    const { community: elsewhere } = await createFixtures();
    const theirs = await aQuestion(elsewhere.id);
    await expect(
      createConsentPurpose(alice, {
        key: "not_mine",
        label: "Theirs",
        noticeText: "...",
        gatesQuestionId: theirs.id,
        requiresExplicit: true,
      }),
    ).rejects.toThrow(NotFoundError);

    const archived = await aQuestion(community.id, "Old");
    await db
      .update(profileQuestion)
      .set({ archivedAt: new Date() })
      .where(eq(profileQuestion.id, archived.id));
    await expect(
      createConsentPurpose(alice, {
        key: "archived_one",
        label: "Archived",
        noticeText: "...",
        gatesQuestionId: archived.id,
        requiresExplicit: true,
      }),
    ).rejects.toThrow(/archived/);
  });

  it("exposes which question each purpose gates, keyed by question id", async () => {
    // The function that existed with no caller for its whole life, while
    // an admin could configure a question-gated purpose and a member could
    // grant and withdraw it and nothing enforced any of it. It is now the
    // read path's gate, so it has to return the right map.
    const { alice, community } = await createFixtures();
    const gated = await aQuestion(community.id, "Allergies");
    const ungated = await aQuestion(community.id, "Home city");
    await createConsentPurpose(alice, {
      key: "kitchen_dietary",
      label: "Kitchen dietary",
      noticeText: "...",
      gatesQuestionId: gated.id,
      requiresExplicit: true,
    });

    const purposes = await getGatingPurposesForQuestions(community.id);
    expect([...purposes.keys()]).toEqual([gated.id]);
    expect(purposes.get(gated.id)!.label).toBe("Kitchen dietary");
    expect(purposes.has(ungated.id)).toBe(false);
  });

  it("deletes a purpose scoped to the community", async () => {
    const { alice } = await createFixtures();
    const created = await createConsentPurpose(alice, { key: "marketing_comms", label: "Marketing", noticeText: "..." });
    await deleteConsentPurpose(alice, created.id);
    expect(await listConsentPurposes(alice)).toHaveLength(0);
  });

  it("rejects deleting a nonexistent purpose", async () => {
    const { alice } = await createFixtures();
    await expect(deleteConsentPurpose(alice, crypto.randomUUID())).rejects.toThrow(NotFoundError);
  });
});

describe("consent grant/withdraw", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("grants, is idempotent while active, and withdraws", async () => {
    const { alice } = await createFixtures();
    const purpose = await createConsentPurpose(alice, { key: "marketing_comms", label: "Marketing", noticeText: "v1 text" });

    const first = await grantConsent(alice, purpose.id, "explicit_action");
    expect(first.noticeVersion).toBe(1);
    expect(await hasActiveConsent(alice.id, purpose.id)).toBe(true);

    const second = await grantConsent(alice, purpose.id, "explicit_action");
    expect(second.id).toBe(first.id);

    const withdrawn = await withdrawConsent(alice, purpose.id);
    expect(withdrawn.withdrawnAt).not.toBeNull();
    expect(await hasActiveConsent(alice.id, purpose.id)).toBe(false);
  });

  it("allows re-granting after withdrawal, as a distinct new row", async () => {
    const { alice } = await createFixtures();
    const purpose = await createConsentPurpose(alice, { key: "marketing_comms", label: "Marketing", noticeText: "..." });

    const first = await grantConsent(alice, purpose.id);
    await withdrawConsent(alice, purpose.id);
    const regranted = await grantConsent(alice, purpose.id);

    expect(regranted.id).not.toBe(first.id);
    expect(await hasActiveConsent(alice.id, purpose.id)).toBe(true);
  });

  it("rejects withdrawing when there's no active consent", async () => {
    const { alice } = await createFixtures();
    const purpose = await createConsentPurpose(alice, { key: "marketing_comms", label: "Marketing", noticeText: "..." });
    await expect(withdrawConsent(alice, purpose.id)).rejects.toThrow(NotFoundError);
  });

  it("denormalizes the purpose's notice_version at grant time", async () => {
    const { alice } = await createFixtures();
    const purpose = await createConsentPurpose(alice, { key: "marketing_comms", label: "Marketing", noticeText: "..." });
    const record = await grantConsent(alice, purpose.id);
    expect(record.noticeVersion).toBe(purpose.noticeVersion);
  });

  it("lists a member's own status across every community purpose", async () => {
    const { alice } = await createFixtures();
    const p1 = await createConsentPurpose(alice, { key: "marketing_comms", label: "Marketing", noticeText: "..." });
    const p2 = await createConsentPurpose(alice, { key: "photo_publication", label: "Photos", noticeText: "..." });
    await grantConsent(alice, p1.id);

    const status = await listMyConsentStatus(alice);
    expect(status).toHaveLength(2);
    const s1 = status.find((s) => s.purpose.id === p1.id)!;
    const s2 = status.find((s) => s.purpose.id === p2.id)!;
    expect(s1.active).toBe(true);
    expect(s2.active).toBe(false);
  });
});
