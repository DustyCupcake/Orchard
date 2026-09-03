"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { db } from "@/db";
import { member, tier } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { assertNotViewingAs } from "@/lib/view-as";
import { answerProfileQuestion } from "@/lib/profile-questions";
import {
  SensitiveFieldKey,
  updateOwnSensitiveData,
  updateOwnSensitiveDataInput,
} from "@/lib/sensitive-data";
import { getGatingPurposesForCommunity, grantConsent, withdrawConsent } from "@/lib/consent";
import {
  contactMethodInput,
  createContactMethod,
  deleteContactMethod,
  updateContactMethod,
} from "@/lib/contact-methods";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/profile?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/profile?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Phase 54 (View-as) -- see src/lib/view-as.ts.
async function requireMember() {
  const actor = await getCurrentMember();
  if (!actor) {
    redirect("/login");
  }
  await assertNotViewingAs();
  return actor;
}

export async function updateProfile(formData: FormData) {
  const current = await requireMember();

  const name = String(formData.get("name") ?? "").trim();
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const submittedTierIds = formData.getAll("tierIds").map(String);
  const emailNotificationsEnabled = formData.get("emailNotificationsEnabled") === "on";

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

  await db
    .update(member)
    .set({ name, tags, tierIds, emailNotificationsEnabled })
    .where(eq(member.id, current.id));
  revalidatePath("/profile");
}

export async function submitProfileAnswerAction(formData: FormData) {
  const current = await requireMember();

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

const SENSITIVE_FIELD_FORM_KEYS: Record<SensitiveFieldKey, string> = {
  health_conditions: "healthConditions",
  allergies: "allergies",
  emergency_contact: "emergencyContact",
  orientation: "orientation",
};

// Phase 46: "filling in a health condition prompts the matching consent
// first, not a separate settings screen visited in advance" — a
// checked "consent_<field>" checkbox on this same form grants consent
// for that field's gating purpose (if any) before the field write is
// attempted, so a single submit does both in one act. Re-derives the
// field->purpose mapping server-side rather than trusting a hidden
// input, since a member could otherwise point a checkbox at an
// arbitrary purpose id.
export async function updateSensitiveDataAction(formData: FormData) {
  const current = await requireMember();

  try {
    const gatingPurposes = await getGatingPurposesForCommunity(current.communityId);
    for (const [fieldKey, formKey] of Object.entries(SENSITIVE_FIELD_FORM_KEYS) as [
      SensitiveFieldKey,
      string,
    ][]) {
      const purpose = gatingPurposes.get(fieldKey);
      if (!purpose) continue;
      if (formData.get(`consent_${formKey}`) === "on") {
        await grantConsent(current, purpose.id, "explicit_action");
      }
    }

    const input = updateOwnSensitiveDataInput.parse({
      healthConditions: String(formData.get("healthConditions") ?? "").trim() || null,
      allergies: String(formData.get("allergies") ?? "").trim() || null,
      emergencyContact: String(formData.get("emergencyContact") ?? "").trim() || null,
      orientation: String(formData.get("orientation") ?? "").trim() || null,
    });
    await updateOwnSensitiveData(current, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/profile");
}

export async function createContactMethodAction(formData: FormData) {
  const current = await requireMember();

  try {
    const input = contactMethodInput.parse({
      type: String(formData.get("type") ?? "").trim(),
      value: String(formData.get("value") ?? "").trim(),
      visibility: String(formData.get("visibility") ?? "everyone"),
    });
    await createContactMethod(current, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/profile");
}

export async function updateContactMethodAction(formData: FormData) {
  const current = await requireMember();

  const id = String(formData.get("id"));
  try {
    const input = contactMethodInput.parse({
      type: String(formData.get("type") ?? "").trim(),
      value: String(formData.get("value") ?? "").trim(),
      visibility: String(formData.get("visibility") ?? "everyone"),
    });
    await updateContactMethod(current, id, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/profile");
}

export async function deleteContactMethodAction(formData: FormData) {
  const current = await requireMember();

  const id = String(formData.get("id"));
  try {
    await deleteContactMethod(current, id);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/profile");
}

// The general consent list — every purpose in the community, including
// ones with no sensitive field to attach an inline prompt to
// (photo_publication, marketing_comms, ...). Field-gating purposes are
// also grantable/withdrawable here, on top of the inline prompt above.
export async function grantConsentAction(formData: FormData) {
  const current = await requireMember();

  const purposeId = String(formData.get("purposeId"));
  try {
    await grantConsent(current, purposeId, "explicit_action");
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/profile");
}

export async function withdrawConsentAction(formData: FormData) {
  const current = await requireMember();

  const purposeId = String(formData.get("purposeId"));
  try {
    await withdrawConsent(current, purposeId);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/profile");
}
