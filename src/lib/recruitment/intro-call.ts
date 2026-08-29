import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recruitmentDecision, schedulingPoll } from "@/db/schema";
import { NotFoundError } from "../errors";
import {
  getApplicantAvailability,
  submitAvailabilityAsApplicant,
  submitAvailabilityInput,
} from "../scheduling-polls";
import type { SubmitAvailabilityInput } from "../scheduling-polls";

export { submitAvailabilityInput as submitIntroCallAvailabilityInput };
export type { SubmitAvailabilityInput as SubmitIntroCallAvailabilityInput };

// Public — no actor, no session. The token is the only proof of
// identity for "you're the applicant this intro call is for" — see
// src/db/schema/recruitment.ts's recruitmentDecision comment for why
// it's stored in plaintext (a human-relayed link, not a login token).
export async function getIntroCallByToken(token: string) {
  const [decision] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.introCallToken, token));
  if (!decision || !decision.introCallPollId) {
    return null;
  }
  const [poll] = await db.select().from(schedulingPoll).where(eq(schedulingPoll.id, decision.introCallPollId));
  if (!poll) {
    return null;
  }
  return { decision, poll };
}

export async function submitIntroCallAvailability(token: string, input: SubmitAvailabilityInput) {
  const found = await getIntroCallByToken(token);
  if (!found) {
    throw new NotFoundError("Intro call not found");
  }
  return submitAvailabilityAsApplicant(found.poll.id, found.decision.formResponseId, input);
}

export async function getIntroCallAvailability(token: string) {
  const found = await getIntroCallByToken(token);
  if (!found) {
    throw new NotFoundError("Intro call not found");
  }
  return getApplicantAvailability(found.poll.id, found.decision.formResponseId);
}
