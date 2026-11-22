import { readCommunityIcon } from "@/lib/settings/community-icon";

// Browsers, feed readers, and link unfurlers ask for /favicon.ico whether or
// not a page links one. Serving it here means a community's uploaded icon
// reaches the places that never read the <head>, and a community that hasn't
// uploaded one still gets the Orchard mark rather than a 404.
export const dynamic = "force-dynamic";

export async function GET() {
  const icon = await readCommunityIcon("favicon.ico");
  if (!icon) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(icon.bytes), {
    headers: {
      "Content-Type": icon.contentType,
      // No version in this URL, so don't claim it is immutable. An hour is
      // long enough to keep the request count down and short enough that a
      // new icon shows up while the person who set it is still looking.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
