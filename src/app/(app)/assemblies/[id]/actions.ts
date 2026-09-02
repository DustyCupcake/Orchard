"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import { addAgendaItem, addAgendaItemInput, submitAssemblyResponse } from "@/lib/assemblies";
import { AppError } from "@/lib/errors";

function redirectWithError(assemblyId: string, err: unknown): never {
  if (err instanceof ZodError) {
    redirect(
      `/assemblies/${assemblyId}?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`,
    );
  }
  if (err instanceof AppError) {
    redirect(`/assemblies/${assemblyId}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function addAgendaItemAction(formData: FormData) {
  const actor = await requireMember();
  const assemblyId = String(formData.get("assemblyId"));

  try {
    const options = String(formData.get("options") ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    const input = addAgendaItemInput.parse({
      text: String(formData.get("text") ?? ""),
      responseType: String(formData.get("responseType") ?? "free_text"),
      options: options.length > 0 ? options : undefined,
    });
    await addAgendaItem(actor, assemblyId, input);
  } catch (err) {
    redirectWithError(assemblyId, err);
  }

  revalidatePath(`/assemblies/${assemblyId}`);
}

export async function submitAssemblyResponseAction(formData: FormData) {
  const actor = await requireMember();
  const assemblyId = String(formData.get("assemblyId"));
  const questionId = String(formData.get("questionId"));
  const multi = formData.getAll("value_multi").map(String);
  const single = formData.get("value");
  const value = multi.length > 0 ? multi : (single ?? "");

  try {
    await submitAssemblyResponse(actor, questionId, { value });
  } catch (err) {
    redirectWithError(assemblyId, err);
  }

  revalidatePath(`/assemblies/${assemblyId}`);
}
