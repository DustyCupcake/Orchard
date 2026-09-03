"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { createPoll, createPollInput } from "@/lib/scheduling-polls";
import { AppError } from "@/lib/errors";

function triState(value: FormDataEntryValue | null): boolean | undefined {
  if (value === "on") return true;
  if (value === "off") return false;
  return undefined;
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

export async function proposePollAction(formData: FormData) {
  const actor = await requireMember();

  const resolutionMode = String(formData.get("resolutionMode") ?? "max_attendance");
  const requiredParticipantIds = formData.getAll("requiredParticipantIds").map(String);
  const minAttendanceRaw = String(formData.get("minAttendance") ?? "");

  let created;
  try {
    const input = createPollInput.parse({
      branchId: String(formData.get("branchId") ?? ""),
      title: String(formData.get("title") ?? ""),
      resolutionMode,
      requiredParticipantIds: resolutionMode === "must_overlap" ? requiredParticipantIds : undefined,
      minAttendance:
        resolutionMode === "max_attendance" && minAttendanceRaw ? Number(minAttendanceRaw) : undefined,
      rangeStart: String(formData.get("rangeStart") ?? ""),
      rangeEnd: String(formData.get("rangeEnd") ?? ""),
      hasAgenda: triState(formData.get("hasAgenda")),
      needsSummary: triState(formData.get("needsSummary")),
      requireRead: triState(formData.get("requireRead")),
    });
    created = await createPoll(actor, input);
  } catch (err) {
    if (err instanceof ZodError) {
      redirect(`/scheduling-polls/new?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
    }
    if (err instanceof AppError) {
      redirect(`/scheduling-polls/new?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect(`/scheduling-polls/${created.id}`);
}
