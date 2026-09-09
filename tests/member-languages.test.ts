import { beforeEach, describe, expect, it } from "vitest";
import {
  addMemberLanguage,
  deleteMemberLanguage,
  listOwnMemberLanguages,
  memberSpeaksLanguage,
} from "@/lib/member-languages";
import { db } from "@/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

describe("member languages", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("adds, lists, and deletes a member's own languages", async () => {
    const { alice } = await createFixtures();

    const created = await addMemberLanguage(alice, { language: "Dutch", level: "fluent" });
    expect(created.language).toBe("Dutch");
    expect(created.level).toBe("fluent");

    const listed = await listOwnMemberLanguages(alice);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);

    await deleteMemberLanguage(alice, created.id);
    expect(await listOwnMemberLanguages(alice)).toHaveLength(0);
  });

  it("supports several languages for the same member", async () => {
    const { alice } = await createFixtures();
    await addMemberLanguage(alice, { language: "Dutch", level: "native" });
    await addMemberLanguage(alice, { language: "English", level: "fluent" });
    await addMemberLanguage(alice, { language: "French", level: "basic" });

    const listed = await listOwnMemberLanguages(alice);
    expect(listed.map((l) => l.language).sort()).toEqual(["Dutch", "English", "French"]);
  });

  it("rejects deleting another member's language entry", async () => {
    const { alice, bob } = await createFixtures();
    const created = await addMemberLanguage(alice, { language: "Dutch", level: "fluent" });

    await expect(deleteMemberLanguage(bob, created.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects deleting a language entry that doesn't exist", async () => {
    const { alice } = await createFixtures();
    await expect(
      deleteMemberLanguage(alice, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(NotFoundError);
  });

  it("memberSpeaksLanguage matches case-insensitively and only for that member", async () => {
    const { alice, bob } = await createFixtures();
    await addMemberLanguage(alice, { language: "Spanish", level: "basic" });

    expect(await memberSpeaksLanguage(db, alice.id, "spanish")).toBe(true);
    expect(await memberSpeaksLanguage(db, alice.id, "SPANISH")).toBe(true);
    expect(await memberSpeaksLanguage(db, alice.id, "french")).toBe(false);
    expect(await memberSpeaksLanguage(db, bob.id, "spanish")).toBe(false);
  });
});
