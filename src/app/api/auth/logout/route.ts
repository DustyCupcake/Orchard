import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/session";
import { resolveAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  await destroySession();
  return NextResponse.redirect(new URL("/", resolveAppUrl(request)));
}
