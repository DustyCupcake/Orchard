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

  try {
    await requestMagicLink(email, resolveAppUrl(request));
  } catch (err) {
    // Swallowed on purpose: an SMTP failure is an ops problem, not
    // something the caller should see or be able to distinguish from a
    // successful send (see the generic response below).
    console.error("[auth/request] failed to send magic link:", err);
  }

  // Always a generic success message — don't reveal whether this email
  // already belongs to a member.
  return NextResponse.json({ ok: true });
}
