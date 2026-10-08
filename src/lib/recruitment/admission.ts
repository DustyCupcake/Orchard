import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { admission, admissionLane } from "@/db/schema";
import type { AdmissionVerification, AdmissionArrivalRoute, AdmissionOrigin } from "@/db/schema";

/**
 * Create an arrival row with the lane's path snapshotted onto it.
 *
 * This is the single place an arrival is created — both the public
 * application and the invite redemption funnel through here. The point is
 * that the path a person will follow is recorded on them when they arrive
 * (§1 principle 2), so editing a lane later changes the *next* arrival
 * and never strands somebody in states the new rule doesn't have.
 *
 * The caller is responsible for:
 *   - resolving the lane (which lane the person is on)
 *   - reading the lane's current configuration
 *   - checking doors/capacity/consent *before* calling
 *
 * This function does not send emails, create sessions, or decide anything.
 * It only writes the row and returns the token the person will use for
 * their private link.
 */
export async function createAdmissionArrival(input: {
  communityId: string;
  cycleId: string | null;
  email: string;
  name: string;
  laneId: string;
  route: AdmissionArrivalRoute;
  origin?: AdmissionOrigin;
  inviteId?: string;
  formResponseId?: string;
  // The lane's current configuration, snapshotted onto the arrival.
  requiredVerification: AdmissionVerification;
  requiredApplication: boolean;
  requiredInterview: boolean;
  requiredEvaluation: boolean;
  reportsNeeded: number | null;
  supportShortcutCount: number | null;
}): Promise<{ arrivalId: string; token: string }> {
  const token = randomBytes(24).toString("base64url");

  const [created] = await db
    .insert(admission)
    .values({
      communityId: input.communityId,
      cycleId: input.cycleId,
      email: input.email.toLowerCase(),
      name: input.name,
      laneId: input.laneId,
      route: input.route,
      origin: input.origin ?? "funnel",
      inviteId: input.inviteId,
      formResponseId: input.formResponseId,
      requiredVerification: input.requiredVerification,
      requiredApplication: input.requiredApplication,
      requiredInterview: input.requiredInterview,
      requiredEvaluation: input.requiredEvaluation,
      reportsNeeded: input.reportsNeeded,
      supportShortcutCount: input.supportShortcutCount,
      token,
    })
    .returning({ id: admission.id });

  return { arrivalId: created.id, token };
}

/**
 * Read the lane row and return the fields that get snapshotted onto an
 * arrival. Kept here so the two entry points (apply + redeem) don't each
 * re-implement the mapping, and so the snapshot is provably the same
 * everywhere an arrival is created.
 */
export async function readLaneSnapshot(laneId: string): Promise<{
  requiredVerification: AdmissionVerification;
  requiredApplication: boolean;
  requiredInterview: boolean;
  requiredEvaluation: boolean;
  reportsNeeded: number | null;
  supportShortcutCount: number | null;
} | null> {
  const [row] = await db
    .select({
      verification: admissionLane.verification,
      applicationRequired: admissionLane.applicationRequired,
      interviewRequired: admissionLane.interviewRequired,
      reportsNeeded: admissionLane.reportsNeeded,
      supportShortcutCount: admissionLane.supportShortcutCount,
    })
    .from(admissionLane)
    .where(eq(admissionLane.id, laneId));

  if (!row) return null;

  // Evaluation is required exactly when the lane has something to evaluate.
  // A lane with neither application nor interview has nothing to report on,
  // so there is no evaluation step — and the panel says "admitted immediately".
  const requiredEvaluation = row.applicationRequired || row.interviewRequired;

  return {
    requiredVerification: row.verification,
    requiredApplication: row.applicationRequired,
    requiredInterview: row.interviewRequired,
    requiredEvaluation,
    reportsNeeded: row.reportsNeeded,
    supportShortcutCount: row.supportShortcutCount,
  };
}

/**
 * Generate a token for the person's private link. Kept separate so it can
 * be tested and so the token format is the same everywhere.
 */
export function generateAdmissionToken(): string {
  return randomBytes(24).toString("base64url");
}