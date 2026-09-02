import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { community, member } from "@/db/schema";
import { createContactMethod } from "@/lib/contact-methods";
import {
  activateEmergencyAccess,
  addEmergencyAccessExplanation,
  listEmergencyAccessActivity,
} from "@/lib/emergency-access";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

describe("emergency access", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns every emergency-only method and logs the activation, without an explanation required up front", async () => {
    const { alice, bob } = await createFixtures();
    await createContactMethod(alice, { type: "phone", value: "555-9999", visibility: "emergency_only" });
    await createContactMethod(alice, { type: "email", value: "a@example.com", visibility: "everyone" });

    const { log, methods } = await activateEmergencyAccess(bob, alice.id);
    expect(methods).toHaveLength(1);
    expect(methods[0].value).toBe("555-9999");
    expect(log.activatedBy).toBe(bob.id);
    expect(log.targetMemberId).toBe(alice.id);
    expect(log.explanation).toBeNull();
  });

  it("still logs an activation even when the target has no emergency-only methods", async () => {
    const { alice, bob } = await createFixtures();
    const { log, methods } = await activateEmergencyAccess(bob, alice.id, "checking on her");
    expect(methods).toHaveLength(0);
    expect(log.explanation).toBe("checking on her");
  });

  it("rejects activating against a member outside the actor's community", async () => {
    const { bob } = await createFixtures();
    const [otherCommunity] = await db.insert(community).values({ name: "Other" }).returning();
    const [stranger] = await db.insert(member).values({ communityId: otherCommunity.id, name: "Stranger" }).returning();

    await expect(activateEmergencyAccess(bob, stranger.id)).rejects.toThrow(NotFoundError);
  });

  it("lets only the original activator add or revise an explanation after the fact", async () => {
    const { alice, bob } = await createFixtures();
    const { log } = await activateEmergencyAccess(bob, alice.id);

    const updated = await addEmergencyAccessExplanation(bob, log.id, "she wasn't answering her phone");
    expect(updated.explanation).toBe("she wasn't answering her phone");

    await expect(addEmergencyAccessExplanation(alice, log.id, "not my activation")).rejects.toThrow(ForbiddenError);
  });

  it("surfaces an activation to both the activator and the target, but nobody else", async () => {
    const { alice, bob, community: testCommunity, branch } = await createFixtures();
    const [carol] = await db.insert(member).values({ communityId: testCommunity.id, name: "Carol" }).returning();
    void branch;

    await activateEmergencyAccess(bob, alice.id, "checking in");

    const bobActivity = await listEmergencyAccessActivity(bob);
    expect(bobActivity).toHaveLength(1);
    expect(bobActivity[0].role).toBe("activator");
    expect(bobActivity[0].counterpartName).toBe("Alice");

    const aliceActivity = await listEmergencyAccessActivity(alice);
    expect(aliceActivity).toHaveLength(1);
    expect(aliceActivity[0].role).toBe("target");
    expect(aliceActivity[0].counterpartName).toBe("Bob");

    const carolActivity = await listEmergencyAccessActivity(carol);
    expect(carolActivity).toHaveLength(0);
  });
});
