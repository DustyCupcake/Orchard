"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { member, tier } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { answerProfileQuestion } from "@/lib/profile-questions";
import { updateOwnSensitiveData, updateOwnSensitiveDataInput } from "@/lib/sensitive-data";

export async function updateProfile(formData: FormData) {
  const current = await getCurrentMember();
  if (!current) {
    redirect("/login");
  }

  const name = String(formData.get("name") ?? "").trim();
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const submittedTierIds = formData.getAll("tierIds").map(String);

  if (!name) {
    return;
  }

  // Only "manual"-criterion tiers are ever offered as checkboxes on this
  // form (see page.tsx) — a computed one (cycle_type_count, as of Phase
  // 40) is owned entirely by its own sync logic
  // (src/lib/settings/tiers.ts's syncComputedTiers). Since this form
  // submits the full checkbox set each time, a plain overwrite would
  // silently drop any already-earned computed tier the moment a member
  // merely saved their name — so only the manual-criterion slice of
  // tierIds is ever replaced from this submission; everything else on
  // the member's existing tierIds (computed, or any other non-manual
  // criterion) carries forward untouched.
  const communityTiers = await db.select().from(tier).where(eq(tier.communityId, current.communityId));
  const manualTierIds = new Set(communityTiers.filter((t) => t.criterionType === "manual").map((t) => t.id));
  const preserved = current.tierIds.filter((id) => !manualTierIds.has(id));
  const nextManual = submittedTierIds.filter((id) => manualTierIds.has(id));
  const tierIds = [...new Set([...preserved, ...nextManual])];

  await db.update(member).set({ name, tags, tierIds }).where(eq(member.id, current.id));
  revalidatePath("/profile");
}

export async function submitProfileAnswerAction(formData: FormData) {
  const current = await getCurrentMember();
  if (!current) {
    redirect("/login");
  }

  const questionId = String(formData.get("questionId"));
  const status = String(formData.get("status")) === "deferred" ? "deferred" : "answered";
  const multi = formData.getAll("value_multi").map(String);
  const single = formData.get("value");
  const value = multi.length > 0 ? multi : (single ?? "");
  const capacityVisibility = formData.get("capacityVisibility") === "open" ? "open" : "flag_only";

  await answerProfileQuestion(current, questionId, {
    status,
    value: status === "answered" ? value : undefined,
    capacityVisibility,
  });
  revalidatePath("/profile");
}

export async function updateSensitiveDataAction(formData: FormData) {
  const current = await getCurrentMember();
  if (!current) {
    redirect("/login");
  }

  const input = updateOwnSensitiveDataInput.parse({
    healthConditions: String(formData.get("healthConditions") ?? "").trim() || null,
    allergies: String(formData.get("allergies") ?? "").trim() || null,
    emergencyContact: String(formData.get("emergencyContact") ?? "").trim() || null,
    orientation: String(formData.get("orientation") ?? "").trim() || null,
  });
  await updateOwnSensitiveData(current, input);
  revalidatePath("/profile");
}
