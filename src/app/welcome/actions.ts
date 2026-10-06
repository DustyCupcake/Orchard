"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { markProfileCompleted } from "@/lib/first-login";
import { addMemberLanguage, MEMBER_LANGUAGE_LEVELS } from "@/lib/member-languages";
import { CONTACT_METHOD_VISIBILITIES, createContactMethod, updateContactMethod } from "@/lib/contact-methods";

function redirectWithError(err: unknown): never {
  const message = err instanceof Error ? err.message : "Something went wrong — try again.";
  redirect(`/welcome?error=${encodeURIComponent(message)}`);
}

// `getCurrentMember`, never `getViewingContext`, and the difference is
// the whole reason this action is safe. A support holder mid-View-as has
// an active overlay whose target may well be a member who has never been
// through this screen; reading the *viewing* member would let one click
// write another person's name and contact visibility, and would mark them
// done without their consent. getCurrentMember always returns the real
// identity behind the cookie, so the worst case here is a support holder
// filling in their own profile, which is what they'd get by visiting /profile.
async function requireMember() {
  const current = await getCurrentMember();
  if (!current) {
    redirect("/login");
  }
  return current;
}

function oneOf<T extends readonly string[]>(value: FormDataEntryValue | null, allowed: T): T[number] | null {
  const raw = String(value ?? "");
  return (allowed as readonly string[]).includes(raw) ? (raw as T[number]) : null;
}

/**
 * First-login setup: the profile values the rest of the app assumes are
 * real, asked once and by the person who owns them.
 *
 * Additive rather than a full profile replace, on purpose. Every field
 * here already has an owner and a home page — `/profile` is where contact
 * methods and languages are managed from the day one, and an invitee who
 * adds a phone number *there* must not have it silently replaced by an
 * empty row because they also stopped by this screen a week later. So this
 * writes what was asked for and nothing else; it never deletes.
 */
export async function completeProfileSetupAction(formData: FormData) {
  const current = await requireMember();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirectWithError(new Error("We need something to call you — even a nickname."));
  }

  const emailNotificationsEnabled = formData.get("emailNotificationsEnabled") === "on";

  try {
    // The name, and the one flat preference that rides on this form. The
    // rest of `/profile`'s updateProfile is deliberately not reused: it
    // also owns tags, tiers and date display, none of which are being
    // asked here, and submitting a form that leaves them out would
    // overwrite them with empties.
    await db
      .update(member)
      .set({ name, emailNotificationsEnabled })
      .where(eq(member.id, current.id));

    // Visibility per existing method. `visibility_<id>` rather than a
    // repeated `visibility`, because each row has its own current value
    // and pairing them up by array position would silently apply one
    // member's choice to another row the moment the order differed.
    //
    // Editing a value here drops that row's verification, which is
    // `updateContactMethod`'s existing rule rather than anything added for
    // this screen: an address typed seconds ago has had nothing sent to it.
    // The seeded primary's value posts back unchanged, so the ordinary
    // case — moving nothing but the visibility — loses nothing.
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("visibility_")) continue;
      const methodId = key.slice("visibility_".length);
      if (!methodId) continue;
      const visibility = oneOf(value, CONTACT_METHOD_VISIBILITIES);
      const type = String(formData.get(`type_${methodId}`) ?? "").trim();
      const methodValue = String(formData.get(`value_${methodId}`) ?? "").trim();
      if (!visibility || !type || !methodValue) continue;
      await updateContactMethod(current, methodId, { type, value: methodValue, visibility });
    }

    // One optional new method. Left blank, it adds nothing — there is no
    // "required" here, because a member whose only contact is the address
    // they just logged in with has, functionally, one already.
    const newType = String(formData.get("newType") ?? "").trim();
    const newValue = String(formData.get("newValue") ?? "").trim();
    const newVisibility = oneOf(formData.get("newVisibility"), CONTACT_METHOD_VISIBILITIES);
    if (newType && newValue) {
      await createContactMethod(current, { type: newType, value: newValue, visibility: newVisibility ?? "everyone" });
    }

    // Languages, one row per pair of repeated fields. Only ever added,
    // never replaced, and a row with a language but no recognised level is
    // dropped rather than defaulted: `conversational` is a real claim
    // about someone's ability, and inferring it from a half-filled row is
    // the kind of guess a Requirement's language check would then act on.
    const languages = formData.getAll("language").map(String);
    const levels = formData.getAll("languageLevel").map(String);
    for (const [index, raw] of languages.entries()) {
      const language = raw.trim();
      if (!language) continue;
      const level = oneOf(levels[index], MEMBER_LANGUAGE_LEVELS);
      if (!level) continue;
      await addMemberLanguage(current, { language, level });
    }
  } catch (err) {
    redirectWithError(err);
  }

  // After the writes, not before, and unconditionally: a partial failure
  // above redirects with the error and leaves this null, so the member is
  // offered the screen again rather than being marked done over a
  // half-applied profile.
  await markProfileCompleted(current.id, { onlyIfUnset: true });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/**
 * Take the "I'll do this later" out of the way.
 *
 * Marks the column exactly as submitting does, which is what makes the
 * screen genuinely once-only instead of a thing that follows somebody
 * around the app. The honest cost is that it never comes back on its own —
 * so the copy on the button is a promise, and everything on this page
 * stays editable at /profile, and that is the deal being made.
 */
export async function skipProfileSetupAction() {
  const current = await requireMember();
  await markProfileCompleted(current.id, { onlyIfUnset: true });
  redirect("/dashboard");
}
