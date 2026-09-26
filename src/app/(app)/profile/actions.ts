"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { db } from "@/db";
import { member, tier } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { assertNotViewingAs } from "@/lib/view-as";
import { answerProfileQuestion, getProfileQuestion } from "@/lib/profile-questions";
import { updateIndicatorConsent } from "@/lib/profile-questions/indicators";
import { fieldValueFromFormData, toFieldShape } from "@/lib/field-shape";
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
import { addMemberLanguage, deleteMemberLanguage, memberLanguageInput } from "@/lib/member-languages";
import { upsertMemberAxisValue } from "@/lib/trait-axes";
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
  const hasDateDisplayMode = formData.has("dateDisplayMode");
  const dateDisplayModeRaw = String(formData.get("dateDisplayMode") ?? "inherit");
  if (!["inherit", "exact", "period"].includes(dateDisplayModeRaw)) {
    redirectWithError(new AppError("Invalid date display preference"));
  }
  const dateDisplayMode = dateDisplayModeRaw === "inherit" ? null : dateDisplayModeRaw === "period" ? "period" : "exact";

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
    .set({ name, tags, tierIds, emailNotificationsEnabled, ...(hasDateDisplayMode && { dateDisplayMode }) })
    .where(eq(member.id, current.id));
  revalidatePath("/profile");
}

// Self-service, on the page that already says "these are your answers":
// how *your* answers get read is yours to decide, and no Admin gets a
// button for it. Mirrors updateContributionVisibility's own shape.
export async function updateIndicatorConsentAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await updateIndicatorConsent(actor, formData.get("consentsToCommunityIndicators") === "on");
  } catch (err) {
    redirectWithError(err);
  }
  // The only readers are /community and /dashboard, neither of which
  // this page revalidates.
  revalidatePath("/profile");
  revalidatePath("/community");
  revalidatePath("/dashboard");
}

export async function submitProfileAnswerAction(formData: FormData) {
  const current = await requireMember();

  const questionId = String(formData.get("questionId"));
  const status = String(formData.get("status")) === "deferred" ? "deferred" : "answered";
  // "declined" is deliberately not honoured here: this is /profile's own
  // "Your answers" editor, where someone is revisiting a value they gave.
  // Retracting consent about your own information is done on /questions,
  // where the question is actually being asked of you.
  //
  // The question row is read here only to know how to interpret the
  // submitted input — a multi_choice submits several values under one
  // name, a choice field with an escape hatch has a second sibling input,
  // and the rest submit one value. Same read the Form path uses.
  // The question row is read here only to know how to interpret the
  // submitted input — a multi_choice submits several values under one
  // name, a choice field with an escape hatch has a second sibling input,
  // and the rest submit one value. Same read the Form path uses.
  const question = await getProfileQuestion(current, questionId);
  const value = fieldValueFromFormData(toFieldShape(question), formData, "value");
  const capacityVisibility = formData.get("capacityVisibility") === "open" ? "open" : "flag_only";

  // A rejected value has to come back as a message on /profile, not as a
  // 500 — this action never routed through redirectWithError, so a
  // malformed answer here (a bad date, an out-of-range number, a
  // mistyped email) surfaced as an unhandled throw. Same handling every
  // other answer action in the app already had.
  try {
    await answerProfileQuestion(current, questionId, {
      status,
      value: status === "answered" ? value : undefined,
      capacityVisibility,
      shareWithAudience: formData.get("shareWithAudience") === "on",
    });
  } catch (err) {
    redirectWithError(err);
  }
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

export async function addMemberLanguageAction(formData: FormData) {
  const current = await requireMember();

  try {
    const input = memberLanguageInput.parse({
      language: String(formData.get("language") ?? "").trim(),
      level: String(formData.get("level") ?? "conversational"),
    });
    await addMemberLanguage(current, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/profile");
}

export async function deleteMemberLanguageAction(formData: FormData) {
  const current = await requireMember();

  const id = String(formData.get("id"));
  try {
    await deleteMemberLanguage(current, id);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/profile");
}

export async function updateMemberAxisAction(formData: FormData) {
  const current = await requireMember();

  const axisId = String(formData.get("axisId"));
  const value = Number(formData.get("value"));
  try {
    await upsertMemberAxisValue(current, axisId, value);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/profile");
  revalidatePath("/dashboard");
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
