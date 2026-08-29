"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { getOrCreateCommunity } from "@/lib/community";
import { submitInquiry, submitInquiryInput } from "@/lib/recruitment";
import { AppError } from "@/lib/errors";

export async function submitInquiryAction(formData: FormData) {
  const community = await getOrCreateCommunity();

  try {
    const input = submitInquiryInput.parse({
      message: String(formData.get("message") ?? "").trim(),
      contactInfo: String(formData.get("contactInfo") ?? "").trim(),
    });
    await submitInquiry(community.id, input);
  } catch (err) {
    if (err instanceof ZodError) {
      redirect(`/inquiry?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
    }
    if (err instanceof AppError) {
      redirect(`/inquiry?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect("/inquiry?submitted=1");
}
