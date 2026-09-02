"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/api";
import { createAssembly, createAssemblyInput } from "@/lib/assemblies";
import { AppError } from "@/lib/errors";

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
