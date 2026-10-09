"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  claimInquiry,
  createCommunityInvite,
  createCommunityInviteInput,
  pokeForSupport,
  resolveInquiry,
  revokeCommunityInvite,
} from "@/lib/recruitment";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/invites?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/invites?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Phase 54 (View-as): every write in this file goes through
// requireMember() below rather than the raw @/lib/api import
// directly, so a session actively rendering as someone else can
// never perform one -- "disabled at the UI layer [...] and
// re-checked/rejected server-side regardless." See src/lib/view-as.ts.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

export async function createCommunityInviteAction(formData: FormData) {
  const actor = await requireMember();
  let created;

  try {
    const input = createCommunityInviteInput.parse({
      label: String(formData.get("label") ?? "").trim() || null,
      inviterThinksGoodFit: formData.get("inviterThinksGoodFit") === "on",
      inviterKnowsPersonally: formData.get("inviterKnowsPersonally") === "on",
      // §2.6/J10 — the inviter's own awareness tick, mandatory on a
      // consensus lane (createCommunityInvite refuses without it) and
      // simply absent anywhere else.
      awarenessConfirmed: formData.get("awarenessConfirmed") === "on",
      cycleId: String(formData.get("cycleId") ?? "").trim() || null,
      expiresAt: String(formData.get("expiresAt") ?? "").trim()
        ? new Date(String(formData.get("expiresAt"))).toISOString()
        : null,
    });
    created = await createCommunityInvite(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/invites");
  // A nomination needs its support link shown straight away — the whole
  // of §2.4's poke option is that the inviter can hand it over or ask
  // specific people *now*, while they still remember who.
  redirect(created ? `/invites?created=1&invite=${created.id}` : "/invites?created=1");
}

// The inviter asks named members to look at their invitee's support link: one
// email each, never a broadcast (docs/admission-flow.md §2). Best-effort, so the
// message says who was reached, and the link is on the page to hand over by hand.
export async function askMembersToSupportAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const memberIds = formData.getAll("memberId").map(String).filter(Boolean);
    const { poked } = await pokeForSupport(actor, String(formData.get("arrivalId") ?? ""), memberIds);
    if (poked.length === 0) {
      throw new AppError("Nobody was asked — pick at least one person, and check they have an email on file");
    }
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/invites");
  redirect("/invites?asked=1");
}

export async function revokeCommunityInviteAction(formData: FormData) {
  const actor = await requireMember();
  const inviteId = String(formData.get("inviteId"));

  try {
    await revokeCommunityInvite(actor, inviteId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/invites");
  redirect("/invites?revoked=1");
}

// Recruitment-task-holder-gated, enforced inside claimInquiry.
export async function claimInquiryAction(formData: FormData) {
  const actor = await requireMember();
  const inquiryId = String(formData.get("inquiryId"));

  try {
    await claimInquiry(actor, inquiryId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/invites");
  redirect("/invites?claimed=1");
}

export async function resolveInquiryAction(formData: FormData) {
  const actor = await requireMember();
  const inquiryId = String(formData.get("inquiryId"));

  try {
    await resolveInquiry(actor, inquiryId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/invites");
  redirect("/invites?inquiryResolved=1");
}
