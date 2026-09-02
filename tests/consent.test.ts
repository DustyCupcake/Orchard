import { beforeEach, describe, expect, it } from "vitest";
import {
  createConsentPurpose,
  deleteConsentPurpose,
  grantConsent,
  hasActiveConsent,
  listConsentPurposes,
  listMyConsentStatus,
  withdrawConsent,
} from "@/lib/consent";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

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

  it("requires explicit consent for anything gating a Sensitive-data field", async () => {
    const { alice } = await createFixtures();
    await expect(
      createConsentPurpose(alice, {
        key: "sensitive_health",
        label: "Health data",
        noticeText: "...",
        gatesSensitiveField: "health_conditions",
        requiresExplicit: false,
      }),
    ).rejects.toThrow(AppError);

    const created = await createConsentPurpose(alice, {
      key: "sensitive_health",
      label: "Health data",
      noticeText: "...",
      gatesSensitiveField: "health_conditions",
      requiresExplicit: true,
    });
    expect(created.gatesSensitiveField).toBe("health_conditions");
  });

  it("rejects a second purpose gating the same field", async () => {
    const { alice } = await createFixtures();
    await createConsentPurpose(alice, {
      key: "sensitive_health",
      label: "Health data",
      noticeText: "...",
      gatesSensitiveField: "health_conditions",
      requiresExplicit: true,
    });
    await expect(
      createConsentPurpose(alice, {
        key: "sensitive_health_2",
        label: "Health data again",
        noticeText: "...",
        gatesSensitiveField: "health_conditions",
        requiresExplicit: true,
      }),
    ).rejects.toThrow(ConflictError);
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
