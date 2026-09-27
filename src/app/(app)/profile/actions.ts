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
import { fieldValueFromFormData, toFieldShape } from "@/lib/field-shape";
import { getGatingPurposesForQuestions, grantConsent, withdrawConsent } from "@/lib/consent";
import { agreeToEmergencyReveal, extendAnswerConsent } from "@/lib/sensitive-data";
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
    // Consent first, and re-derived from the question rather than trusted
    // from the form: the `consent_<key>` checkbox names a purpose *key*, and
    // a member could otherwise point one at a purpose this question isn't
    // gated by and grant themselves something unrelated. The question is
    // already loaded above, so the lookup is a single map hit.
    const purposes = await getGatingPurposesForQuestions(current.communityId);
    const purpose = purposes.get(question.id);
    if (purpose && formData.get(`consent_${purpose.key}`) === "on") {
      await grantConsent(current, purpose.id, "explicit_action");
    }

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

/**
 * Agree to share one answer with one newly-added audience.
 *
 * Self-service and about exactly one (answer, rule) pair on purpose. The
 * list it serves is already per-rule so a member can say yes to the
 * kitchen team without handing over to the group added last week, and this
 * action agrees to precisely the pair the button names — there is no
 * "extend sharing" *for a question*, because that is a different and much
 * wider decision than the one on the button.
 *
 * `assertNotViewingAs` because this writes about the member's own data
 * and an Admin reading somebody else's profile must not be able to answer
 * on their behalf. The lib scopes the write to the answer's own owner too,
 * so a forged POST is refused even if it gets this far.
 */
export async function extendAnswerConsentAction(formData: FormData) {
  const current = await requireMember();
  try {
    assertNotViewingAs();
    await extendAnswerConsent(
      current,
      String(formData.get("answerId") ?? ""),
      String(formData.get("ruleId") ?? ""),
    );
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/profile");
}

/**
 * Agree to have one answer revealed by whoever activates emergency mode.
 *
 * The emergency counterpart of `extendAnswerConsentAction`, and the same
 * three constraints apply for the same reasons: self-service, one
 * (answer) rather than a whole question, and scoped to the answer's own
 * owner in the lib so a forged POST can't agree on someone else's behalf.
 *
 * `assertNotViewingAs` for the same reason as there — an Admin reading
 * somebody else's profile must not be able to widen what can be pulled
 * out of their page in a crisis.
 */
export async function agreeToEmergencyRevealAction(formData: FormData) {
  const current = await requireMember();
  try {
    assertNotViewingAs();
    await agreeToEmergencyReveal(current, String(formData.get("answerId") ?? ""));
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/profile");
}
