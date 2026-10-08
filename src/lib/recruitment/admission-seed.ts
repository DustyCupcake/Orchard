import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { admissionLane } from "@/db/schema";
import { JOINING_LANE_DEFAULTS, JOINING_LANE_COPY } from "./lanes";
import type { AdmissionLaneKind, AdmissionVerification } from "@/db/schema";

/**
 * Seed the four admission lanes for a community. Used by tests and by any
 * code that creates a new community after migration 0089 has already run.
 *
 * Mirrors the seed in migration 0089_admission_lane.sql.
 */
export async function seedAdmissionLanesForCommunity(communityId: string) {
  // Check if lanes already exist for this community
  const existing = await db
    .select({ count: sql`count(*)` })
    .from(admissionLane)
    .where(eq(admissionLane.communityId, communityId));
  
  if (Number(existing[0]?.count) > 0) {
    return; // Already seeded
  }

  const lanes = [
    {
      kind: "invite" as AdmissionLaneKind,
      name: JOINING_LANE_COPY.invited_knows_personally.title,
      handlesKnowsPersonally: true,
      handlesGoodFitOnly: false,
      handlesNeither: false,
      applicationRequired: JOINING_LANE_DEFAULTS.invited_knows_personally.applicationRequired,
      interviewRequired: JOINING_LANE_DEFAULTS.invited_knows_personally.interviewRequired,
      verification: "none" as AdmissionVerification,
      reportsNeeded: null,
      supportShortcutCount: null,
    },
    {
      kind: "invite" as AdmissionLaneKind,
      name: JOINING_LANE_COPY.invited_good_fit.title,
      handlesKnowsPersonally: false,
      handlesGoodFitOnly: true,
      handlesNeither: false,
      applicationRequired: JOINING_LANE_DEFAULTS.invited_good_fit.applicationRequired,
      interviewRequired: JOINING_LANE_DEFAULTS.invited_good_fit.interviewRequired,
      verification: "none" as AdmissionVerification,
      reportsNeeded: 2,
      supportShortcutCount: null,
    },
    {
      kind: "invite" as AdmissionLaneKind,
      name: JOINING_LANE_COPY.invited_neither.title,
      handlesKnowsPersonally: false,
      handlesGoodFitOnly: false,
      handlesNeither: true,
      applicationRequired: JOINING_LANE_DEFAULTS.invited_neither.applicationRequired,
      interviewRequired: JOINING_LANE_DEFAULTS.invited_neither.interviewRequired,
      verification: "none" as AdmissionVerification,
      reportsNeeded: 2,
      supportShortcutCount: null,
    },
    {
      kind: "public" as AdmissionLaneKind,
      name: JOINING_LANE_COPY.public_application.title,
      handlesKnowsPersonally: false,
      handlesGoodFitOnly: false,
      handlesNeither: false,
      applicationRequired: JOINING_LANE_DEFAULTS.public_application.applicationRequired,
      interviewRequired: JOINING_LANE_DEFAULTS.public_application.interviewRequired,
      verification: "none" as AdmissionVerification,
      reportsNeeded: 2,
      supportShortcutCount: null,
    },
  ];

  await db.insert(admissionLane).values(
    lanes.map((lane) => ({
      communityId,
      ...lane,
    })),
  );
}