"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import {
  confirmEventProposalSlot,
  confirmEventProposalSlotInput,
  createEventProposal,
  createEventProposalInput,
  declineEventProposal,
  pingConflictHost,
  publishEventSchedule,
  updateEventProposal,
  updateEventProposalInput,
} from "@/lib/event-scheduling";
import { AppError } from "@/lib/errors";

// "startsAt|endsAt" per line — the same plain-textarea convention
// Budget's line items and Forms' fields already use rather than a
// dynamic add-row UI; this codebase has no client-side JS beyond
// Scheduling polls' one deliberate exception.
function parseSlots(raw: string) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [startsAt, endsAt] = line.split("|").map((p) => p?.trim() ?? "");
      return {
        startsAt: startsAt ? new Date(startsAt).toISOString() : "",
        endsAt: endsAt ? new Date(endsAt).toISOString() : "",
      };
    });
}

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/schedule?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/schedule?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Open to any member — "any member submits a proposal."
export async function submitEventProposalAction(formData: FormData) {
  const actor = await requireMember();

  try {
    const input = createEventProposalInput.parse({
      host: String(formData.get("host") ?? "").trim(),
      title: String(formData.get("title") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || undefined,
      durationMinutes: Number(formData.get("durationMinutes") ?? NaN),
      spaceNeeds: String(formData.get("spaceNeeds") ?? "").trim() || null,
      preferredSlots: parseSlots(String(formData.get("preferredSlotsRaw") ?? "")),
    });
    await createEventProposal(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/schedule");
  redirect("/schedule?submitted=1");
}

// Submitter-only, enforced inside updateEventProposal.
export async function updateEventProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));

  try {
    const input = updateEventProposalInput.parse({
      host: String(formData.get("host") ?? "").trim(),
      title: String(formData.get("title") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || undefined,
      durationMinutes: Number(formData.get("durationMinutes") ?? NaN),
      spaceNeeds: String(formData.get("spaceNeeds") ?? "").trim() || null,
      preferredSlots: parseSlots(String(formData.get("preferredSlotsRaw") ?? "")),
    });
    await updateEventProposal(actor, proposalId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/schedule");
  redirect("/schedule?updated=1");
}

// Owner-only, enforced inside confirmEventProposalSlot.
export async function confirmEventProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));

  try {
    const startsAtRaw = String(formData.get("startsAt") ?? "");
    const endsAtRaw = String(formData.get("endsAt") ?? "");
    const input = confirmEventProposalSlotInput.parse({
      startsAt: startsAtRaw ? new Date(startsAtRaw).toISOString() : "",
      endsAt: endsAtRaw ? new Date(endsAtRaw).toISOString() : "",
    });
    await confirmEventProposalSlot(actor, proposalId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/schedule");
  redirect("/schedule?confirmed=1");
}

// Owner-only, enforced inside declineEventProposal.
export async function declineEventProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));

  try {
    await declineEventProposal(actor, proposalId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/schedule");
  redirect("/schedule?declined=1");
}

// Owner-only, enforced inside pingConflictHost.
export async function pingConflictHostAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));

  try {
    await pingConflictHost(actor, proposalId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/schedule");
  redirect("/schedule?pinged=1");
}

// Owner-only, enforced inside publishEventSchedule. Takes no fields of
// its own — bound to a plain <form action={...}> with nothing but a
// submit button.
export async function publishEventScheduleAction() {
  const actor = await requireMember();

  try {
    await publishEventSchedule(actor, undefined);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/schedule");
  redirect("/schedule?published=1");
}
