import type { NextRequest } from "next/server";
import { readCommunityIcon } from "@/lib/settings/community-icon";

// The generated icon set, served from the database. Versioned URLs
// (`?v=<iconUpdatedAt>`) are immutable forever; an unversioned request — a
// browser asking for the bare `/favicon.ico` it remembers — is cached for an
// hour so a changed icon still appears the same day.
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ variant: string }> },
) {
  const { variant } = await params;
  const icon = await readCommunityIcon(variant);
  if (!icon) {
    return new Response("Not found", { status: 404 });
  }

  const versioned = request.nextUrl.searchParams.has("v");
  return new Response(new Uint8Array(icon.bytes), {
    headers: {
      "Content-Type": icon.contentType,
      "Cache-Control": versioned
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    },
  });
}
