import type { MetadataRoute } from "next";
import { db } from "@/db";
import { community } from "@/db/schema";

// The install manifest: what a phone reads when someone adds the community to
// their home screen. It names the app and points at the same generated icon
// set as the browser tab, including a maskable variant so Android can crop it
// to the launcher's own shape without cutting the mark off.
//
// force-dynamic because the name, colour, and icon version are the
// community's, and this is a single-tenant install whose one row can change.
export const dynamic = "force-dynamic";

const DEFAULT_ACCENT = "#3a6cd9";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let row:
    | { name: string; accentPrimary: string | null; iconUpdatedAt: Date | null }
    | undefined;

  try {
    [row] = await db
      .select({
        name: community.name,
        accentPrimary: community.accentPrimary,
        iconUpdatedAt: community.iconUpdatedAt,
      })
      .from(community)
      .limit(1);
  } catch {
    // A manifest is not worth failing an install prompt over: fall back to
    // the mark and the documented accent, the same fallbacks the root layout
    // uses when the database isn't reachable at build time.
  }

  const name = row?.name?.trim() || "Orchard";
  const version = row?.iconUpdatedAt?.getTime();
  const suffix = version ? `?v=${version}` : "";

  return {
    name,
    short_name: name,
    description: "Task-based, distributed-effort coordination.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f5f0",
    theme_color: row?.accentPrimary || DEFAULT_ACCENT,
    icons: [
      {
        src: `/api/community/icon/192${suffix}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/api/community/icon/512${suffix}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/api/community/icon/maskable-512${suffix}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
