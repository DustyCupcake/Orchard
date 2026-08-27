import { NextRequest, NextResponse } from "next/server";
import { requestMagicLink } from "@/lib/magic-link";
import { resolveAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  await requestMagicLink(email, resolveAppUrl(request));

  // Always a generic success message — don't reveal whether this email
  // already belongs to a member.
  return NextResponse.json({ ok: true });
}
