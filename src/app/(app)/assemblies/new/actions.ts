"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { createAssembly, createAssemblyInput } from "@/lib/assemblies";
import { AppError } from "@/lib/errors";

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

export async function proposeAssemblyAction(formData: FormData) {
  const actor = await requireMember();

  let created;
  try {
    const input = createAssemblyInput.parse({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      agendaMinutes: Number(formData.get("agendaMinutes") ?? NaN),
      noticeMinutes: Number(formData.get("noticeMinutes") ?? NaN),
      votingMinutes: Number(formData.get("votingMinutes") ?? NaN),
    });
    created = await createAssembly(actor, input);
  } catch (err) {
    if (err instanceof ZodError) {
      redirect(`/assemblies/new?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
    }
    if (err instanceof AppError) {
      redirect(`/assemblies/new?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect(`/assemblies/${created.id}`);
}
